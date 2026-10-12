import {
	appendFileSync as append_file_sync,
	mkdirSync as mkdir_sync,
	mkdtempSync as mkdtemp_sync,
	readFileSync as read_file_sync,
	rmSync as rm_sync,
	writeFileSync as write_file_sync,
} from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync as gzip_sync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compress_session_chunk, read_session_gzip } from "../src/core/session-gzip.ts";
import {
	entryToHtmlLine as entry_to_html_line,
	type JsonObject,
	sessionHtmlToEntries as session_html_to_entries,
} from "../src/core/session-html.ts";

const entries: JsonObject[] = [
	{ type: "session", id: "session", version: 3, cwd: "/work" },
	{ type: "message", id: "first", parentId: null, message: { role: "user", content: "cafe \u2615\n<&>" } },
	{ type: "message", id: "second", parentId: "first", message: { role: "assistant", content: "answer" } },
];
const rows = entries.map((entry) => `${entry_to_html_line(entry, "session")}\n`);
const members = rows.map(compress_session_chunk);

describe("compressed session chunks", () => {
	it("reads entries appended to a real file without rewriting earlier bytes", () => {
		const scratch = resolve(import.meta.dirname, "../../../../../artifacts/pi");
		mkdir_sync(scratch, { recursive: true });
		const directory = mkdtemp_sync(join(scratch, "session-gzip-"));
		const file = join(directory, "session.gz");
		try {
			write_file_sync(file, members[0]);
			for (const member of members.slice(1)) append_file_sync(file, member);
			const bytes = read_file_sync(file);
			expect(bytes.subarray(0, members[0].length)).toEqual(members[0]);
			const result = read_session_gzip(bytes);
			expect(session_html_to_entries(result.text)).toEqual(entries);
			expect(result.valid_bytes).toBe(bytes.length);
			expect(result.incomplete_bytes).toBe(0);
		} finally {
			rm_sync(directory, { recursive: true });
		}
	});

	it("finds the last complete member at every truncated-tail byte", () => {
		const prefix = Buffer.concat(members.slice(0, 2));
		const tail = members[2];
		for (let cut = 0; cut < tail.length; cut += 1) {
			const bytes = Buffer.concat([prefix, tail.subarray(0, cut)]);
			const result = read_session_gzip(bytes);
			expect(result.text).toBe(rows.slice(0, 2).join(""));
			expect(result.valid_bytes).toBe(prefix.length);
			expect(result.incomplete_bytes).toBe(cut);
			expect(bytes).toEqual(Buffer.concat([prefix, tail.subarray(0, cut)]));
			const repaired = Buffer.concat([bytes.subarray(0, result.valid_bytes), tail]);
			expect(session_html_to_entries(read_session_gzip(repaired).text)).toEqual(entries);
		}
	});

	it("refuses checksum corruption in any complete member", () => {
		for (let index = 0; index < members.length; index += 1) {
			const damaged = members.map((member) => Buffer.from(member));
			damaged[index][damaged[index].length - 8] ^= 1;
			expect(() => read_session_gzip(Buffer.concat(damaged))).toThrow();
		}
	});

	it("rejects garbage and gzip features the writer does not emit", () => {
		expect(() => read_session_gzip(Buffer.concat([members[0], Buffer.from("garbage")]))).toThrow(/header/);
		const flags = Buffer.from(members[0]);
		flags[3] = 8;
		expect(() => read_session_gzip(flags)).toThrow(/header/);
	});

	it("requires complete rows and accepts multi-row batches", () => {
		expect(() => compress_session_chunk("unfinished")).toThrow(/newline/);
		expect(() => read_session_gzip(gzip_sync("unfinished"))).toThrow(/newline/);
		expect(read_session_gzip(compress_session_chunk(rows.join(""))).text).toBe(rows.join(""));
	});

	it("handles an empty file without inventing entries", () => {
		expect(read_session_gzip(Buffer.alloc(0))).toEqual({ text: "", valid_bytes: 0, incomplete_bytes: 0 });
	});
});
