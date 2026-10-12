import { gunzipSync as gunzip_sync, gzipSync as gzip_sync, inflateRawSync as inflate_raw_sync } from "node:zlib";

export interface SessionGzipRead {
	text: string;
	/** End of the last verified member; callers must preserve or repair the tail before appending. */
	valid_bytes: number;
	incomplete_bytes: number;
}

/** One appendable gzip member. Input rows must already include their newline. */
export const compress_session_chunk = (html: string): Buffer => {
	if (!html.endsWith("\n")) throw new Error("Session chunk must end with a newline");
	return gzip_sync(html);
};

/** Read members from compress_session_chunk, rejecting corruption and retaining incomplete tail bytes. */
export const read_session_gzip = (bytes: Uint8Array): SessionGzipRead => {
	const input = Buffer.from(bytes);
	const prefix = Buffer.from([31, 139, 8, 0]);
	const chunks: Buffer[] = [];
	let offset = 0;
	while (offset < input.length) {
		const remaining = input.subarray(offset);
		const prefix_length = Math.min(prefix.length, remaining.length);
		if (!remaining.subarray(0, prefix_length).equals(prefix.subarray(0, prefix_length))) {
			throw new Error(`Invalid session gzip header at byte ${offset}`);
		}
		if (remaining.length < 10) break;
		let inflated: { engine: { bytesWritten: number } };
		try {
			inflated = inflate_raw_sync(remaining.subarray(10), { info: true }) as unknown as typeof inflated;
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "Z_BUF_ERROR") break;
			throw error;
		}
		const member_size = 10 + inflated.engine.bytesWritten + 8;
		if (remaining.length < member_size) break;
		const decoded = gunzip_sync(remaining.subarray(0, member_size));
		if (decoded.length === 0 || decoded[decoded.length - 1] !== 10) {
			throw new Error(`Session gzip member must end with a newline at byte ${offset}`);
		}
		chunks.push(decoded);
		offset += member_size;
	}
	return {
		text: Buffer.concat(chunks).toString("utf8"),
		valid_bytes: offset,
		incomplete_bytes: input.length - offset,
	};
};
