import { Type } from "typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeSimple } from "../src/compat.ts";
import type { AssistantMessage, Model, Tool, Usage } from "../src/types.ts";
import { sanitizeAssistantMessage } from "../src/utils/tool-call-leak.ts";

const mockState = vi.hoisted(() => ({
	chunks: [] as unknown[],
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: () => {
					const stream = {
						async *[Symbol.asyncIterator]() {
							for (const chunk of mockState.chunks) yield chunk;
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}
	return { default: FakeOpenAI };
});

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const readTool: Tool = {
	name: "read",
	description: "Read a file",
	parameters: Type.Object({
		path: Type.String(),
		offset: Type.Optional(Type.Number()),
		limit: Type.Optional(Type.Number()),
	}),
};

const bashTool: Tool = {
	name: "bash",
	description: "Run a command",
	parameters: Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number()) }),
};

const model = {
	id: "deepseek/deepseek-v4.1-flash",
	name: "DeepSeek V4.1 Flash",
	api: "openai-completions",
	provider: "openrouter",
	baseUrl: "https://openrouter.ai/api/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000_000,
	maxTokens: 64_000,
} satisfies Omit<Model<"openai-completions">, "compat">;

const complete = (tools: Tool[]) =>
	completeSimple(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }], tools }, { apiKey: "test" });

const delta = (value: Record<string, unknown>) => ({ choices: [{ delta: value, finish_reason: null }] });
const finish = (reason: string) => ({
	choices: [{ delta: {}, finish_reason: reason }],
	usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

// The fullwidth bar the model uses around its control tokens.
const bar = "\uff5c";

describe("openai-completions leaked tool call recovery", () => {
	beforeEach(() => {
		mockState.chunks = [];
	});

	it("turns leaked parameter text into a real tool call and keeps the prose", async () => {
		mockState.chunks = [
			delta({ content: "Found it. Let me read that filter.\n\n" }),
			delta({
				content:
					'<parameter name="path">/tmp/pages.js</parameter>\n' +
					`${bar}DSML${bar} parameter name="offset" string="false">75</${bar}DSML${bar} parameter>\n` +
					`${bar}DSML${bar} parameter name="limit" string="false">55</${bar}DSML${bar} parameter>`,
			}),
			finish("stop"),
		];
		const message = await complete([readTool, bashTool]);
		expect(message.content).toEqual([
			{ type: "text", text: "Found it. Let me read that filter." },
			{
				type: "toolCall",
				id: expect.stringContaining("call_recovered"),
				name: "read",
				arguments: { path: "/tmp/pages.js", offset: 75, limit: 55 },
			},
		]);
		expect(message.stopReason).toBe("toolUse");
	});

	it("names the tool from an outer parameter when the invoke tag is missing", async () => {
		mockState.chunks = [
			delta({ content: 'Running it.\n<parameter name="bash">\n' }),
			delta({ content: `${bar}DSML${bar} parameter name="command" string="true">ls -la</parameter>` }),
			finish("stop"),
		];
		const message = await complete([readTool, bashTool]);
		const call = message.content.find((block) => block.type === "toolCall");
		expect(call).toMatchObject({ name: "bash", arguments: { command: "ls -la" } });
		expect(message.content.find((block) => block.type === "text")).toEqual({
			type: "text",
			text: "Running it.",
		});
	});

	it("stops string arguments at leaked markup and drops phantom calls", async () => {
		const leaked = JSON.stringify({
			path: `/tmp/x.js\n${bar}DSML${bar} parameter name="offset" string="false">75\n`,
		});
		mockState.chunks = [
			delta({
				tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read", arguments: leaked } }],
			}),
			delta({
				tool_calls: [{ index: 1, id: "call_2", type: "function", function: { name: "...", arguments: "" } }],
			}),
			finish("tool_calls"),
		];
		const message = await complete([readTool, bashTool]);
		expect(message.content).toEqual([
			{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "/tmp/x.js" } },
		]);
	});

	it("leaves prose and markdown tables alone", async () => {
		const prose = "| Capability | Realness | plans |\n| --- | --- | --- |\nNothing to do.\n";
		mockState.chunks = [delta({ content: prose }), finish("stop")];
		const message = await complete([readTool, bashTool]);
		expect(message.content).toEqual([{ type: "text", text: prose }]);
		expect(message.stopReason).toBe("stop");
	});

	it("cleans control tokens from replayed reasoning signatures", () => {
		const message: AssistantMessage = {
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: `quoted ${bar}DSML${bar} marker`,
					thinkingSignature: JSON.stringify([{ type: "reasoning.text", text: `quoted ${bar}DSML${bar} marker` }]),
				},
			],
			api: "openai-completions",
			provider: "openrouter",
			model: "deepseek/deepseek-v4.1-flash",
			usage,
			stopReason: "stop",
			timestamp: 2,
		};
		sanitizeAssistantMessage(message, [readTool]);
		expect(message.content[0]).toMatchObject({
			thinking: "quoted  marker",
			thinkingSignature: JSON.stringify([{ type: "reasoning.text", text: "quoted  marker" }]),
		});
	});
});
