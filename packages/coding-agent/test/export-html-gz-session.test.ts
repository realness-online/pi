import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportSessionToHtmlGz } from "../src/core/session-export.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { assistantMsg, userMsg } from "./utilities.ts";

describe("html.gz session export", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) rmSync(tempDir, { recursive: true, force: true });
	});

	it("writes a session that opens again with the same ID and messages", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-html-gz-export-"));
		tempDirs.push(tempDir);
		const sessionManager = SessionManager.inMemory(tempDir);
		sessionManager.appendMessage(userMsg("hello"));
		sessionManager.appendMessage(assistantMsg("hi there"));

		const filePath = exportSessionToHtmlGz(sessionManager, join(tempDir, "out", "saved.html.gz"));
		const reopened = SessionManager.open(filePath, tempDir, tempDir);

		expect(reopened.getSessionId()).toBe(sessionManager.getSessionId());
		expect(reopened.getBranch().map((entry) => entry.type)).toEqual(["message", "message"]);
	});
});
