import {
	appendFileSync as append_file_sync,
	mkdirSync as mkdir_sync,
	mkdtempSync as mkdtemp_sync,
	readFileSync as read_file_sync,
	readdirSync as readdir_sync,
	rmSync as rm_sync,
} from "node:fs";
import { join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportFromFile as export_from_file } from "../src/core/export-html/index.ts";
import { compress_session_chunk, read_session_gzip } from "../src/core/session-gzip.ts";
import { loadEntriesFromFile as load_entries_from_file, SessionManager } from "../src/core/session-manager.ts";

let directory: string;
beforeEach(() => {
	const scratch = resolve(import.meta.dirname, "../../../../../artifacts/pi");
	mkdir_sync(scratch, { recursive: true });
	directory = mkdtemp_sync(join(scratch, "storage-"));
	vi.stubEnv("PI_SESSION_FORMAT", "html.gz");
});
afterEach(() => {
	vi.unstubAllEnvs();
	rm_sync(directory, { recursive: true });
});
const message = (content: string) => ({ role: "user" as const, content, timestamp: Date.now() });
const create_session = () => {
	const manager = SessionManager.create(directory, directory);
	manager.appendMessage(message("first <&> \u2615"));
	return manager;
};

describe("opt-in compressed session storage", () => {
	it("persists and resumes through SessionManager without rewriting previous chunks", () => {
		const manager = create_session();
		const file = manager.getSessionFile()!;
		expect(file).toMatch(/\.html\.gz$/);
		const before = read_file_sync(file);
		manager.appendCustomEntry("optional");
		manager.appendMessage(message("second"));
		expect(read_file_sync(file).subarray(0, before.length)).toEqual(before);
		const resumed = SessionManager.open(file);
		expect(resumed.getEntries()).toEqual(JSON.parse(JSON.stringify(manager.getEntries())));
		expect(resumed.buildSessionContext()).toEqual(manager.buildSessionContext());
	});

	it("discovers, continues, branches and forks compressed history", async () => {
		const manager = create_session();
		const root = manager.getLeafId()!;
		manager.appendMessage(message("abandoned"));
		manager.branch(root);
		manager.appendMessage(message("alternate"));
		expect(SessionManager.open(manager.getSessionFile()!).getTree()[0].children).toHaveLength(2);
		expect(SessionManager.findById(directory, manager.getSessionId(), directory)).toBe(manager.getSessionFile());
		expect((await SessionManager.list(directory, directory))[0].messageCount).toBe(3);
		expect(SessionManager.continueRecent(directory, directory).getSessionId()).toBe(manager.getSessionId());
		const source = manager.getSessionFile()!;
		const branch = manager.createBranchedSession(manager.getLeafId()!)!;
		expect(branch).toMatch(/\.html\.gz$/);
		expect(SessionManager.open(branch).getEntries()).toHaveLength(2);
		const fork = SessionManager.forkFrom(source, directory, directory);
		expect(fork.getEntries()).toEqual(SessionManager.open(source).getEntries());
		expect(fork.getHeader()?.parentSession).toBe(source);
	});

	it("reads partial tails without modification, then saves and repairs them before append", () => {
		const manager = create_session();
		const file = manager.getSessionFile()!;
		const before = read_file_sync(file);
		const tail = compress_session_chunk("unfinished row\n").subarray(0, 15);
		append_file_sync(file, tail);
		expect(load_entries_from_file(file)).toHaveLength(2);
		expect(read_file_sync(file)).toEqual(Buffer.concat([before, tail]));
		const resumed = SessionManager.open(file);
		resumed.appendMessage(message("after recovery"));
		const backup = readdir_sync(directory).find((name) => name.includes(".tail-"))!;
		expect(read_file_sync(join(directory, backup))).toEqual(tail);
		expect(load_entries_from_file(file)).toHaveLength(3);
		expect(read_session_gzip(read_file_sync(file)).incomplete_bytes).toBe(0);
	});

	it("refuses a competing lock and preserves the file", () => {
		const manager = create_session();
		const file = manager.getSessionFile()!;
		const before = read_file_sync(file);
		const release = lockfile.lockSync(file);
		try {
			expect(() => manager.appendMessage(message("blocked"))).toThrow();
			expect(read_file_sync(file)).toEqual(before);
		} finally {
			release();
		}
	});

	it("exports compressed sessions as decoded HTML", async () => {
		const manager = create_session();
		const output = join(directory, "export.html");
		await export_from_file(manager.getSessionFile()!, output);
		expect(read_file_sync(output, "utf8")).toContain("<!DOCTYPE html>");
	});

	it("switches new files back to JSONL without changing existing compressed sessions", () => {
		const compressed = create_session();
		vi.stubEnv("PI_SESSION_FORMAT", "jsonl");
		const jsonl = create_session();
		expect(jsonl.getSessionFile()).toMatch(/\.jsonl$/);
		compressed.appendMessage(message("still compressed"));
		expect(load_entries_from_file(compressed.getSessionFile()!)).toHaveLength(3);
		expect(SessionManager.open(jsonl.getSessionFile()!).getEntries()).toEqual(jsonl.getEntries());
	});
});
