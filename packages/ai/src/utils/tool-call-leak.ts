/**
 * Recovers tool calls that arrive as plain text instead of structured calls.
 *
 * DeepSeek models sometimes write their native call markup into the text
 * channel: `\uff5cDSML\uff5c` control tokens around `invoke`/`parameter` fragments. The
 * markup is not a call the provider parsed, and it is not prose a reader wants.
 * Stored once, it also teaches the model to repeat it. The prose stays; the
 * control tokens go; and when the model clearly intended a call whose arguments
 * match a declared tool, that call is rebuilt so the turn keeps going.
 */

import type { AssistantMessage, JsonObject, JsonValue, TextContent, Tool, ToolCall } from "../types.ts";

const TOKEN_NAMES = "DSML|end\u2581of\u2581(?:thinking|sentence)|begin\u2581of\u2581(?:thinking|sentence)";
const TOKEN_CORE = `[\\uff5c|]\\s*(?:${TOKEN_NAMES})\\s*[\\uff5c|]`;
/** One `\uff5cDSML\uff5c`, `</|DSML|parameter>`, or `\uff5cend\u2581of\u2581thinking\uff5c` run, angle brackets included. */
const CONTROL_TOKEN = new RegExp(`(?:<\\/?\\s*)?${TOKEN_CORE}(?:\\s*[^<>\\n]*>)?`, "g");
/** Where a leaked call fragment begins. */
const LEAK_START = /<\/?(?:invoke|parameter)\b|[\uff5c|]\s*DSML\s*[\uff5c|]/;
/** A parameter opening tag. Its `<` is optional: a stripped control token may have eaten it. */
const PARAMETER_OPEN = /<?parameter\s+name\s*=\s*"([^"]+)"(?:\s+string\s*=\s*"(true|false)")?\s*>/g;
const INVOKE = /<invoke\s+name\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/g;

/** Removes the provider's control tokens wherever they appear. */
export const stripControlTokens = (value: string): string => value.replace(CONTROL_TOKEN, "");

/**
 * A string argument that swallowed leaked markup: keep the value before the
 * fragment and drop the rest.
 */
export const repairLeakedString = (value: string): string => {
	const start = value.search(LEAK_START);
	return stripControlTokens(start < 0 ? value : value.slice(0, start)).trimEnd();
};

const parameterValue = (raw: string, isString: string | undefined): JsonValue => {
	const value = stripControlTokens(raw).trim();
	if (isString === "true") return value;
	try {
		return JSON.parse(value) as JsonValue;
	} catch {
		return value;
	}
};

interface RawParameter {
	name: string;
	isString?: string;
	value: string;
}

/**
 * Reads parameter openings in order. A value runs to the next opening or its
 * closing tag, whichever comes first - leaked parameters often close late or
 * not at all.
 */
const collectRawParameters = (segment: string): RawParameter[] => {
	const openings = [...segment.matchAll(new RegExp(PARAMETER_OPEN.source, "g"))];
	return openings.map((opening, index) => {
		const start = opening.index + opening[0].length;
		const beforeNext = openings[index + 1]?.index ?? segment.length;
		const closing = segment.indexOf("</parameter>", start);
		const end = closing >= 0 && closing < beforeNext ? closing : beforeNext;
		return { name: opening[1], isString: opening[2], value: segment.slice(start, end) };
	});
};

const collectParameters = (parameters: RawParameter[]): JsonObject => {
	const args: JsonObject = {};
	for (const parameter of parameters) args[parameter.name] = parameterValue(parameter.value, parameter.isString);
	return args;
};

const schemaProperties = (tool: Tool): string[] => {
	const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties;
	return properties ? Object.keys(properties) : [];
};

const requiredProperties = (tool: Tool): string[] => {
	const required = (tool.parameters as { required?: unknown }).required;
	return Array.isArray(required) ? required.filter((key): key is string => typeof key === "string") : [];
};

/** Every argument belongs to the tool's schema and every required one is present. */
const callMatchesTool = (name: string, args: JsonObject, tools: Tool[]): boolean => {
	const tool = tools.find((candidate) => candidate.name === name);
	if (!tool) return false;
	const properties = schemaProperties(tool);
	const keys = Object.keys(args);
	if (properties.length > 0 && !keys.every((key) => properties.includes(key))) return false;
	return requiredProperties(tool).every((key) => key in args);
};

/** The single declared tool whose schema accepts exactly these argument names. */
const inferToolName = (args: JsonObject, tools: Tool[]): string | undefined => {
	const keys = Object.keys(args);
	if (keys.length === 0) return undefined;
	const candidates = tools.filter((tool) => {
		const properties = schemaProperties(tool);
		return properties.length > 0 && keys.every((key) => properties.includes(key));
	});
	return candidates.length === 1 ? candidates[0].name : undefined;
};

const parseLeakedCalls = (segment: string, tools: Tool[]): { name: string; arguments: JsonObject }[] => {
	const normalized = normalizeMarkup(segment);
	const calls: { name: string; arguments: JsonObject }[] = [];
	for (const match of normalized.matchAll(new RegExp(INVOKE.source, "g"))) {
		calls.push({ name: match[1], arguments: collectParameters(collectRawParameters(match[2])) });
	}
	if (calls.length > 0) return calls;

	const parameters = collectRawParameters(normalized);
	// `parameter name="bash">` wrapping the real parameters names the tool itself.
	const first = parameters[0];
	if (first && tools.some((tool) => tool.name === first.name) && first.value.trim().length === 0) {
		const args = collectParameters(parameters.slice(1));
		if (Object.keys(args).length > 0) return [{ name: first.name, arguments: args }];
	}

	const args = collectParameters(parameters);
	const inferred = inferToolName(args, tools);
	return inferred && Object.keys(args).length > 0 ? [{ name: inferred, arguments: args }] : [];
};

/**
 * A control token can stand in for `<` or `</` around an invoke/parameter tag.
 * Restore those tags, then drop every remaining token.
 */
const normalizeMarkup = (segment: string): string =>
	segment
		.replace(new RegExp(`</\\s*${TOKEN_CORE}\\s*(?=(?:parameter|invoke)\\b)`, "g"), "</")
		.replace(new RegExp(`${TOKEN_CORE}\\s*(?=(?:parameter|invoke)\\b)`, "g"), "<")
		.replace(new RegExp(TOKEN_CORE, "g"), "");

/**
 * Leaves `text` prose-only. When the trailing markup parses into calls the
 * declared tools accept, returns them for the caller to append; otherwise
 * returns text with the markup removed and no calls.
 */
export const recoverLeakedCalls = (text: string, tools: Tool[]): { text: string; calls: ToolCall[] } | undefined => {
	if (tools.length === 0) return undefined;
	const start = text.search(LEAK_START);
	if (start < 0) return undefined;
	const head = text.slice(0, start).trimEnd();
	const parsed = parseLeakedCalls(text.slice(start), tools).filter((call) =>
		callMatchesTool(call.name, call.arguments, tools),
	);
	return {
		text: head,
		calls: parsed.map((call, index) => ({
			type: "toolCall",
			id: `call_recovered_${Date.now().toString(36)}_${index}`,
			name: call.name,
			arguments: call.arguments,
		})),
	};
};

const hasControlTokens = (value: string): boolean => /[\uff5c|]\s*(?:DSML|end\u2581of|begin\u2581of)/.test(value);

const cleanJsonStrings = (value: unknown): unknown => {
	if (typeof value === "string") return stripControlTokens(value);
	if (Array.isArray(value)) return value.map(cleanJsonStrings);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanJsonStrings(item)]));
	}
	return value;
};

/** Reasoning signatures replay to the provider, so leaked tokens must leave them too. */
const cleanThinkingSignature = (signature: string | undefined): string | undefined => {
	if (!signature || !hasControlTokens(signature)) return signature;
	try {
		return JSON.stringify(cleanJsonStrings(JSON.parse(signature)));
	} catch {
		return stripControlTokens(signature);
	}
};

const isTextBlock = (block: AssistantMessage["content"][number]): block is TextContent => block.type === "text";

const isPhantomCall = (block: ToolCall): boolean => /^[.\u00b7\u2026\s]*$/.test(block.name);

/**
 * Cleans one assistant message in place: control tokens leave text, thinking
 * and arguments; string arguments stop at leaked markup; phantom calls go; and
 * a text-only leaked call becomes a real one.
 */
export const sanitizeAssistantMessage = (message: AssistantMessage, tools: Tool[]): void => {
	for (const block of message.content) {
		if (block.type === "thinking") {
			block.thinking = stripControlTokens(block.thinking);
			block.thinkingSignature = cleanThinkingSignature(block.thinkingSignature);
		} else if (block.type === "toolCall") {
			block.name = stripControlTokens(block.name).trim();
			for (const [key, value] of Object.entries(block.arguments)) {
				if (typeof value === "string") block.arguments[key] = repairLeakedString(value);
			}
		}
	}
	message.content = message.content.filter((block) => block.type !== "toolCall" || !isPhantomCall(block));

	if (message.content.some((block) => block.type === "toolCall")) return;
	const text = message.content.find(isTextBlock);
	if (!text) return;
	const recovered = recoverLeakedCalls(text.text, tools);
	if (!recovered) {
		text.text = stripControlTokens(text.text);
		return;
	}
	text.text = recovered.text;
	if (recovered.calls.length === 0) return;
	message.content.push(...recovered.calls);
	message.stopReason = "toolUse";
};
