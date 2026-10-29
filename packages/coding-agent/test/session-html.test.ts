import { describe, expect, it } from "vitest";
import {
	entryToHtmlLine,
	htmlLineToEntry,
	type JsonObject,
	sessionHtmlToEntries,
	sessionJsonlToHtml,
} from "../src/core/session-html.ts";

const SESSION = "01a0f2ed-0000-7000-8000-000000000001";

const header = {
	type: "session",
	version: 3,
	id: SESSION,
	timestamp: "2026-09-30T18:00:00.000Z",
	cwd: "/Users/scott/Desktop/realness",
};

const assistant: JsonObject = {
	type: "message",
	id: "a1b2c3d4",
	parentId: "9f8e7d6c",
	timestamp: "2026-09-30T18:00:01.000Z",
	message: {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "Two lines\nof thought" },
			{ type: "text", text: 'Tags <b> & "quotes" stay text' },
			{
				type: "toolCall",
				id: "call_1",
				name: "bash",
				arguments: { command: "ls\n\u001b[1mbold\u001b[0m", timeout: null },
			},
		],
		usage: { input: 12, output: 0, cost: { total: 0.25 }, cacheRead: -0 },
		stopReason: "toolUse",
		errorMessage: "",
		flags: [true, false, null, [], {}, [[1, "one"]], ["single"]],
	},
};

const roundTrip = (entry: JsonObject) => htmlLineToEntry(entryToHtmlLine(entry, SESSION));

describe("session rows as HTML Lines", () => {
	it("turns reference values into links and reads them back by the same key paths", () => {
		const links = (path: string[], value: string) =>
			["conversationId", "owner.conversationId"].includes(path.join(".")) ? `/items/${value}` : undefined;
		const entry = { type: "entry", id: "9", parentId: "8", conversationId: 1, owner: { conversationId: 3, taskId: 4 } };
		const row = entryToHtmlLine(entry, SESSION, undefined, links);
		expect(row).toContain('<link itemprop="conversationId" href="/items/1">');
		expect(row).toContain('<link itemprop="conversationId" href="/items/3">');
		const back = htmlLineToEntry(row, new Set(["conversationId", "owner.conversationId"]));
		expect(back).toEqual({ ...entry, parentId: "8" });
	});

	it("keeps lone surrogates through UTF-8", () => {
		const entry = { type: "custom", id: "s1", parentId: null, text: "a\uD800b\uDC00c\uD83D\uDE00d" };
		const row = entryToHtmlLine(entry, SESSION);
		expect(row).toContain("&#55296;");
		expect(row).toContain("&#56320;");
		expect(row).toContain("\uD83D\uDE00");
		expect(htmlLineToEntry(Buffer.from(row, "utf8").toString("utf8"))).toEqual(entry);
	});

	it("names the row by itemtype and itemid, and links its parent", () => {
		const row = entryToHtmlLine(
			{ type: "label", id: "aa", parentId: "bb", timestamp: "t", targetId: "cc", label: "x" },
			SESSION,
		);
		expect(row).toBe(
			`<article itemscope itemtype="/sessions/label" itemid="/sessions/${SESSION}/aa">` +
				`<link itemprop="parentId" href="/sessions/${SESSION}/bb">` +
				`<span itemprop="timestamp">t</span><span itemprop="targetId">cc</span><span itemprop="label">x</span>` +
				"</article>",
		);
	});

	it("starts ids with the owner's phone, like Realness", () => {
		const row = entryToHtmlLine({ type: "label", id: "aa", parentId: "bb" }, SESSION, "+14155550100");
		expect(row).toContain(`itemtype="/sessions/label" itemid="/+14155550100/sessions/${SESSION}/aa"`);
		expect(row).toContain(`href="/+14155550100/sessions/${SESSION}/bb"`);
		expect(entryToHtmlLine(header, "ignored", "+14155550100")).toContain(
			`itemid="/+14155550100/sessions/${SESSION}"`,
		);
		expect(htmlLineToEntry(entryToHtmlLine(assistant, SESSION, "+14155550100"))).toEqual(roundTrip(assistant));
		const html = sessionJsonlToHtml(JSON.stringify(assistant), SESSION, "+14155550100");
		expect(html).toContain(`itemid="/+14155550100/sessions/${SESSION}/a1b2c3d4"`);
		expect(() => entryToHtmlLine(header, SESSION, "14155550100")).toThrow(/phone/);
		expect(() => entryToHtmlLine(header, SESSION, "+1/../x")).toThrow(/phone/);
	});

	it("gives the header its session's itemid", () => {
		expect(entryToHtmlLine(header, "ignored")).toContain(`itemid="/sessions/${SESSION}"`);
		expect(roundTrip(header)).toEqual(header);
	});

	it("keeps every JSON type, empty and nested containers, and -0", () => {
		const back = roundTrip(assistant);
		expect(back).toStrictEqual(assistant);
		expect(Object.is((back.message as any).usage.cacheRead, -0)).toBe(true);
	});

	it("keeps each row on one line, whatever the text holds", () => {
		const row = entryToHtmlLine(assistant, SESSION);
		expect(row).not.toMatch(/[\n\r\u001b]/);
		expect(row).toContain('<pre itemprop="thinking">Two lines&#10;of thought</pre>');
		expect(row).toContain('Tags &lt;b&gt; &amp; "quotes" stay text');
	});

	it("keeps a parentId of null, and ids with slashes", () => {
		const first = { type: "message", id: "x/y", parentId: null, timestamp: "t" };
		expect(roundTrip(first)).toStrictEqual(first);
		const child = { type: "message", id: "c", parentId: "x/y", timestamp: "t" };
		expect(roundTrip(child)).toStrictEqual(child);
	});

	it("keeps entries whose id comes late, and odd keys as plain properties", () => {
		// Only JSON.parse makes "__proto__" an own property, as a session line would.
		const line = '{"type":"custom","customType":"plan","data":{"__proto__":1,"a b":"c"},"id":"dd","parentId":"ee"}';
		const back = roundTrip(JSON.parse(line));
		expect(JSON.stringify(back)).toBe(
			'{"type":"custom","id":"dd","customType":"plan","data":{"__proto__":1,"a b":"c"},"parentId":"ee"}',
		);
		expect(Object.keys(back.data as object)).toEqual(["__proto__", "a b"]);
		expect(Object.getPrototypeOf(back.data)).toBe(Object.prototype);
	});

	it("converts a whole file, taking the session from the header or the name", () => {
		const jsonl = `${[header, assistant].map((entry) => JSON.stringify(entry)).join("\n")}\n`;
		const html = sessionJsonlToHtml(jsonl, "from-file-name");
		expect(html.split("\n")).toHaveLength(3);
		expect(html).toContain(`itemid="/sessions/${SESSION}/a1b2c3d4"`);
		// JSONL itself writes -0 as 0, so compare with what the lines hold.
		const lines = jsonl
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(sessionHtmlToEntries(html)).toStrictEqual(lines);
		const fragment = sessionJsonlToHtml(JSON.stringify(assistant), "from-file-name");
		expect(fragment).toContain('itemid="/sessions/from-file-name/a1b2c3d4"');
	});

	it("refuses markup it did not write", () => {
		expect(() => htmlLineToEntry("<p>hello</p>")).toThrow("Not a session row");
		expect(() =>
			htmlLineToEntry('<article itemscope itemtype="/sessions/message"><b itemprop="x">1</b></article>'),
		).toThrow("Not a session row");
		expect(() =>
			htmlLineToEntry('<article itemscope itemtype="/sessions/message"><span itemprop="x">1</span>'),
		).toThrow("Not a session row");
	});

	it("refuses anything after the row", () => {
		const row = entryToHtmlLine({ type: "message", id: "a", parentId: null }, SESSION);
		expect(htmlLineToEntry(row)).toStrictEqual({ type: "message", id: "a", parentId: null });
		expect(() => htmlLineToEntry(`${row}<span itemprop="x">y</span>`)).toThrow("Not a session row");
	});

	it("refuses values JSON cannot hold", () => {
		expect(() => entryToHtmlLine({ type: "message", n: Number.NaN } as JsonObject, SESSION)).toThrow("Not a JSON");
	});
});
