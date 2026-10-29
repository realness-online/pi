import { describe, expect, it } from "vitest";
import { buildSessionContext, type FileEntry, SessionManager } from "../../src/core/session-manager.ts";
import { assistantMsg, userMsg } from "../utilities.ts";

// Rows another writer keeps in the same file (Durable tasks, commits) have no parentId.
const entries = [
	{ type: "commit", id: "seq-1", writes: 1 },
	{ type: "message", id: "a", parentId: null, timestamp: "2026-10-29T00:00:01.000Z", message: userMsg("hi") },
	{ type: "task", id: "t", state: { status: "running" } },
	{ type: "message", id: "b", parentId: "a", timestamp: "2026-10-29T00:00:02.000Z", message: assistantMsg("hello") },
	{ type: "message", id: "s", parentId: null, timestamp: "2026-10-29T00:00:03.000Z", message: userMsg("sub") },
	{ type: "document", id: "d", content: {} },
] as unknown as FileEntry[];

const open = () => SessionManager.inMemory(process.cwd(), undefined, entries);

describe("rows without parentId", () => {
	it("are indexed but are never the leaf, a root, or a child", () => {
		const session = open();
		expect(session.getEntries()).toHaveLength(6);
		expect(session.getEntry("t")).toBeDefined();
		expect(session.getLeafId()).toBe("s");
		expect(session.getTree().map((node) => node.entry.id)).toEqual(["a", "s"]);
		expect(session.getTree()[0].children.map((node) => node.entry.id)).toEqual(["b"]);
	});

	it("leave the default context on the newest tree entry", () => {
		const all = open().getEntries();
		expect(buildSessionContext(all.slice(0, 4)).messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(buildSessionContext(all, "b").messages.map((m) => m.role)).toEqual(["user", "assistant"]);
	});
});
