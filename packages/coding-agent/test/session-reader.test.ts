import { spawnSync as spawn_sync } from "node:child_process";
import {
	mkdirSync as mkdir_sync,
	mkdtempSync as mkdtemp_sync,
	readFileSync as read_file_sync,
	rmSync as rm_sync,
	writeFileSync as write_file_sync,
} from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compress_session_chunk } from "../src/core/session-gzip.ts";
import { sessionJsonlToHtml as session_jsonl_to_html } from "../src/core/session-html.ts";

const scratch = resolve(import.meta.dirname, "../../../../review-v1.2.0/reader-tests");
const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rm_sync(directory, { recursive: true, force: true });
});
const fixture = (suffix: string, tail: string) => {
	mkdir_sync(scratch, { recursive: true });
	const directory = mkdtemp_sync(join(scratch, "reader-"));
	directories.push(directory);
	const entries = [
		{ type: "session", version: 3, id: "reader-fixture", cwd: directory },
		{
			type: "message",
			id: "u1",
			timestamp: "2026-10-13T00:00:00.000Z",
			message: { role: "user", content: "reader proof" },
		},
	];
	const html = session_jsonl_to_html(
		entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
		"reader-fixture",
	);
	const text = html + tail;
	const compressed = tail.endsWith("\n")
		? compress_session_chunk(text)
		: Buffer.concat([compress_session_chunk(html), compress_session_chunk(`${tail}\n`).subarray(0, 15)]);
	const file = join(directory, `session.${suffix}`);
	write_file_sync(file, suffix === "html.gz" ? compressed : text);
	const before = read_file_sync(file);
	const result = spawn_sync(process.execPath, [resolve(import.meta.dirname, "../src/session-read.ts"), file], {
		encoding: "utf8",
	});
	expect(read_file_sync(file)).toEqual(before);
	return { result, entries };
};

describe("installed reader live-tail contract", () => {
	for (const suffix of ["html", "html.gz"]) {
		it(`reads ${suffix} complete rows without changing an unfinished final row`, () => {
			const { result, entries } = fixture(suffix, "<article itemscope");
			expect(result.status, result.stderr).toBe(0);
			expect(
				result.stdout
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line)),
			).toEqual(entries);
		});
		it(`rejects ${suffix} complete malformed rows`, () => {
			const { result } = fixture(suffix, "<article itemscope></article>\n");
			expect(result.status).not.toBe(0);
		});
	}
});
