import { spawnSync as spawn_sync } from "node:child_process";
import {
	appendFileSync as append_file_sync,
	mkdirSync as mkdir_sync,
	mkdtempSync as mkdtemp_sync,
	readFileSync as read_file_sync,
	readdirSync as readdir_sync,
	rmSync as rm_sync,
	writeFileSync as write_file_sync,
} from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compact_closed_session } from "../src/core/session-compaction.ts";
import { compress_session_chunk } from "../src/core/session-gzip.ts";
import { loadEntriesFromFile as load_entries_from_file, SessionManager } from "../src/core/session-manager.ts";

let directory: string;
let file: string;
beforeEach(() => {
	const scratch = resolve(import.meta.dirname, "../../../../../artifacts/pi");
	mkdir_sync(scratch, { recursive: true });
	directory = mkdtemp_sync(join(scratch, "compaction-"));
	const result = spawn_sync(
		process.execPath,
		["--experimental-strip-types", resolve(import.meta.dirname, "fixtures/compressed-session-writer.js"), directory],
		{ encoding: "utf8", timeout: 20000 },
	);
	expect(result.status, result.stderr).toBe(0);
	file = result.stdout;
});
afterEach(() => {
	rm_sync(directory, { recursive: true });
});

describe("closed compressed session compaction", () => {
	it("compacts an exited writer's history, preserving entries and a byte-exact backup", () => {
		const before = read_file_sync(file);
		const entries = load_entries_from_file(file);
		const result = compact_closed_session(file);
		expect(result.after_bytes).toBeLessThan(result.before_bytes);
		expect(read_file_sync(result.backup)).toEqual(before);
		expect(load_entries_from_file(file)).toEqual(entries);
		const resumed = SessionManager.open(file);
		resumed.appendMessage({ role: "user", content: "after compaction", timestamp: Date.now() });
		expect(load_entries_from_file(file)).toHaveLength(entries.length + 1);
		expect(() => compact_closed_session(file)).toThrow(/live writer/);
	});

	it("refuses a live writer without touching session bytes", () => {
		write_file_sync(`${file}.writer-${process.pid}`, JSON.stringify({ pid: process.pid, host: hostname() }));
		const before = read_file_sync(file);
		expect(() => compact_closed_session(file)).toThrow(/live writer/);
		expect(read_file_sync(file)).toEqual(before);
		expect(readdir_sync(directory).some((name) => name.includes("before-compaction"))).toBe(false);
	});

	it("treats an unknown writer host as live", () => {
		write_file_sync(`${file}.writer-remote`, JSON.stringify({ pid: 1, host: "unknown-host" }));
		expect(() => compact_closed_session(file)).toThrow(/live writer/);
	});

	it("refuses an incomplete tail without losing it", () => {
		append_file_sync(file, compress_session_chunk("unfinished\n").subarray(0, 15));
		const before = read_file_sync(file);
		expect(() => compact_closed_session(file)).toThrow(/incomplete tail/);
		expect(read_file_sync(file)).toEqual(before);
	});

	it("refuses corruption and leaves the original intact", () => {
		const damaged = read_file_sync(file);
		damaged[damaged.length - 8] ^= 1;
		write_file_sync(file, damaged);
		expect(() => compact_closed_session(file)).toThrow();
		expect(read_file_sync(file)).toEqual(damaged);
	});

	it("respects the same lock as live appends", () => {
		const release = lockfile.lockSync(file);
		try {
			expect(() => compact_closed_session(file)).toThrow();
		} finally {
			release();
		}
	});
});
