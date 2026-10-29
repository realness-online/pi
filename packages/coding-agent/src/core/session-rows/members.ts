/**
 * Appended session files are concatenated gzip members, one per write. Browsers
 * decode only the first member, and one cut-off member fails a whole-file
 * decode, so readers walk members one at a time. The walk needs only a raw
 * inflate, which Node's zlib and the browser's pako both provide.
 */

/** Raw-inflates deflate data from its start. */
export type RawInflate = (
	data: Uint8Array,
) => { readonly status: "end"; readonly output: Uint8Array; readonly consumed: number } | { readonly status: "short" };

export interface MembersRead {
	text: string;
	/** End of the last verified member; callers must preserve or repair the tail before appending. */
	valid_bytes: number;
	incomplete_bytes: number;
}

const HEADER = [0x1f, 0x8b, 8, 0];
const HEADER_LENGTH = 10;
const TRAILER_LENGTH = 8;

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

const uint32 = (bytes: Uint8Array, at: number) =>
	(bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;

/**
 * Read members written one per append. A member cut off at the end is the
 * incomplete tail; any other damage throws. Each member must end in a newline.
 */
export function readMembers(bytes: Uint8Array, inflate: RawInflate): MembersRead {
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const parts: string[] = [];
	let offset = 0;
	while (offset < bytes.length) {
		const left = bytes.length - offset;
		for (let i = 0; i < Math.min(HEADER.length, left); i++)
			if (bytes[offset + i] !== HEADER[i]) throw new Error(`Invalid session gzip header at byte ${offset}`);
		if (left < HEADER_LENGTH) break;
		const inflated = inflate(bytes.subarray(offset + HEADER_LENGTH));
		if (inflated.status === "short") break;
		const size = HEADER_LENGTH + inflated.consumed + TRAILER_LENGTH;
		if (size > left) break;
		const trailer = offset + HEADER_LENGTH + inflated.consumed;
		const { output } = inflated;
		if (uint32(bytes, trailer) !== crc32(output) || uint32(bytes, trailer + 4) !== output.length >>> 0)
			throw new Error(`Session gzip member fails its check at byte ${offset}`);
		if (output.length === 0 || output[output.length - 1] !== 10)
			throw new Error(`Session gzip member must end with a newline at byte ${offset}`);
		parts.push(decoder.decode(output));
		offset += size;
	}
	return { text: parts.join(""), valid_bytes: offset, incomplete_bytes: bytes.length - offset };
}
