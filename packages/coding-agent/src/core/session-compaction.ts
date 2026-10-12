import { randomUUID as random_uuid } from "node:crypto";
import {
	existsSync as exists_sync,
	readFileSync as read_file_sync,
	readdirSync as readdir_sync,
	renameSync as rename_sync,
	unlinkSync as unlink_sync,
	writeFileSync as write_file_sync,
} from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual as is_deep_strict_equal } from "node:util";
import lockfile from "proper-lockfile";
import { compress_session_chunk, read_session_gzip } from "./session-gzip.ts";
import { sessionHtmlToEntries as session_html_to_entries } from "./session-html.ts";

/** Unknown hosts or process permissions are treated as live; PID reuse blocks rather than risks compaction. */
const writer_is_live = (marker: string): boolean => {
	const owner: unknown = JSON.parse(read_file_sync(marker, "utf8"));
	if (
		!owner ||
		typeof owner !== "object" ||
		!("pid" in owner) ||
		!("host" in owner) ||
		owner.host !== hostname() ||
		typeof owner.pid !== "number" ||
		!Number.isSafeInteger(owner.pid) ||
		owner.pid <= 0
	)
		return true;
	try {
		process.kill(owner.pid, 0);
		return true;
	} catch (error) {
		return !(error instanceof Error && "code" in error && error.code === "ESRCH");
	}
};

/** Shared guard for compaction, conversion, and rollback. */
export const assert_session_closed = (path: string): void => {
	const markers = readdir_sync(dirname(path)).filter((name) => name.startsWith(`${basename(path)}.writer-`));
	if (markers.some((name) => writer_is_live(join(dirname(path), name))))
		throw new Error("Cannot modify a session with a live writer");
};

/** Compact only after marked writers exit; preserve the original and reject incomplete or corrupt files. */
export const compact_closed_session = (path: string): { before_bytes: number; after_bytes: number; backup: string } => {
	if (!path.endsWith(".html.gz")) throw new Error("Compaction requires a compressed HTML session");
	const release = lockfile.lockSync(path);
	const temporary = `${path}.compacting-${random_uuid()}`;
	try {
		assert_session_closed(path);
		const before = read_file_sync(path);
		const decoded = read_session_gzip(before);
		if (decoded.incomplete_bytes) throw new Error("Cannot compact a session with an incomplete tail");
		const original = session_html_to_entries(decoded.text);
		if (original[0]?.type !== "session" || typeof original[0].id !== "string")
			throw new Error("Cannot compact a session without a valid header");
		const packed = compress_session_chunk(decoded.text);
		write_file_sync(temporary, packed, { flag: "wx", mode: 0o600, flush: true });
		const verified = session_html_to_entries(read_session_gzip(read_file_sync(temporary)).text);
		if (!is_deep_strict_equal(verified, original)) throw new Error("Compacted session differs from its original");
		if (!read_file_sync(path).equals(before)) throw new Error("Session changed during compaction");
		const backup = `${path}.before-compaction-${random_uuid()}`;
		write_file_sync(backup, before, { flag: "wx", mode: 0o600, flush: true });
		rename_sync(temporary, path);
		return { before_bytes: before.length, after_bytes: packed.length, backup };
	} finally {
		if (exists_sync(temporary)) unlink_sync(temporary);
		release();
	}
};
