/** Node's side of session members: zlib for compressing and for the raw inflate. */
import { gzipSync as gzip_sync, inflateRawSync as inflate_raw_sync } from "node:zlib";
import { type MembersRead, type RawInflate, readMembers } from "./members.ts";

export type SessionGzipRead = MembersRead;

export const node_inflate_raw: RawInflate = (data) => {
	try {
		const result = inflate_raw_sync(data, { info: true }) as unknown as {
			buffer: Buffer;
			engine: { bytesWritten: number };
		};
		return { status: "end", output: result.buffer, consumed: result.engine.bytesWritten };
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "Z_BUF_ERROR") return { status: "short" };
		throw error;
	}
};

/** One appendable gzip member. Input rows must already include their newline. */
export const compress_session_chunk = (html: string): Buffer => {
	if (!html.endsWith("\n")) throw new Error("Session chunk must end with a newline");
	return gzip_sync(html);
};

/** Read members from compress_session_chunk, rejecting corruption and retaining incomplete tail bytes. */
export const read_session_gzip = (bytes: Uint8Array): SessionGzipRead => readMembers(bytes, node_inflate_raw);
