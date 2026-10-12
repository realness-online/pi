import { randomUUID as random_uuid } from "node:crypto";
import {
	appendFileSync as append_file_sync,
	closeSync as close_sync,
	existsSync as exists_sync,
	fsyncSync as fsync_sync,
	ftruncateSync as ftruncate_sync,
	linkSync as link_sync,
	openSync as open_sync,
	readFileSync as read_file_sync,
	renameSync as rename_sync,
	unlinkSync as unlink_sync,
	writeFileSync as write_file_sync,
} from "node:fs";
import { hostname } from "node:os";
import lockfile from "proper-lockfile";
import { compress_session_chunk, read_session_gzip } from "./session-gzip.ts";
import {
	entryToHtmlLine as entry_to_html_line,
	type JsonObject,
	sessionHtmlToEntries as session_html_to_entries,
} from "./session-html.ts";

export const is_html_session = (path: string): boolean => path.endsWith(".html") || path.endsWith(".html.gz");
export const is_session_file = (path: string): boolean => path.endsWith(".jsonl") || is_html_session(path);

/** Controls only new files; existing sessions retain their encoding. */
export const new_session_suffix = (): string => {
	const format = process.env.PI_SESSION_FORMAT ?? "jsonl";
	if (format !== "jsonl" && format !== "html.gz") throw new Error(`Invalid PI_SESSION_FORMAT: ${format}`);
	return format;
};

/** JSON serialization removes optional undefined fields exactly as JSONL does. */
export const encode_session_entry = (entry: unknown, session_id: string, path: string): string | Buffer => {
	const json = JSON.stringify(entry);
	if (!is_html_session(path)) return `${json}\n`;
	const row = `${entry_to_html_line(JSON.parse(json) as JsonObject, session_id)}\n`;
	return path.endsWith(".gz") ? compress_session_chunk(row) : row;
};

/** Read-only decoding: discovery and recall must never repair a live writer's tail. */
export const read_html_session = (path: string): JsonObject[] => {
	const bytes = read_file_sync(path);
	return session_html_to_entries(path.endsWith(".gz") ? read_session_gzip(bytes).text : bytes.toString("utf8"));
};

/** Conservative writer marker: compaction waits until this process exits. */
const mark_writer = (path: string): void => {
	const marker = `${path}.writer-${process.pid}`;
	if (!exists_sync(marker))
		write_file_sync(marker, JSON.stringify({ pid: process.pid, host: hostname() }), {
			flag: "wx",
			mode: 0o600,
			flush: true,
		});
};

/** Initialize or rewrite under the append lock, then publish the complete file atomically. */
export const write_compressed_session = (
	path: string,
	entries: unknown[],
	session_id: string,
	exclusive = false,
): void => {
	const packed = Buffer.concat(entries.map((entry) => encode_session_entry(entry, session_id, path) as Buffer));
	const release = lockfile.lockSync(path, { realpath: false });
	const temporary = `${path}.writing-${random_uuid()}`;
	try {
		mark_writer(path);
		write_file_sync(temporary, packed, { flag: "wx", mode: 0o600, flush: true });
		if (exclusive) {
			link_sync(temporary, path);
			unlink_sync(temporary);
		} else {
			if (exists_sync(path))
				write_file_sync(`${path}.before-rewrite-${random_uuid()}`, read_file_sync(path), {
					flag: "wx",
					mode: 0o600,
					flush: true,
				});
			rename_sync(temporary, path);
		}
	} finally {
		if (exists_sync(temporary)) unlink_sync(temporary);
		release();
	}
};

/** All compressed writers share a lock; save incomplete bytes before truncating and appending. */
export const append_compressed_entry = (path: string, entry: unknown, session_id: string): void => {
	const encoded = encode_session_entry(entry, session_id, path);
	const release = lockfile.lockSync(path);
	try {
		mark_writer(path);
		const bytes = read_file_sync(path);
		const result = read_session_gzip(bytes);
		if (result.incomplete_bytes) {
			const header = session_html_to_entries(result.text)[0];
			if (header?.type !== "session" || header.id !== session_id)
				throw new Error("Cannot repair session without a verified header");
			write_file_sync(`${path}.tail-${random_uuid()}`, bytes.subarray(result.valid_bytes), {
				flag: "wx",
				mode: 0o600,
				flush: true,
			});
			const fd = open_sync(path, "r+");
			try {
				ftruncate_sync(fd, result.valid_bytes);
				fsync_sync(fd);
			} finally {
				close_sync(fd);
			}
		}
		append_file_sync(path, encoded);
	} finally {
		release();
	}
};
