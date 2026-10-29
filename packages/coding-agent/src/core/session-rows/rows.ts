/**
 * Session entries as HTML Lines: one microdata row per line.
 *
 *   <article itemscope itemtype="/sessions/message" itemid="/+<phone>/sessions/<session>/<entry>">
 *   <link itemprop="parentId" href="/+<phone>/sessions/<session>/<parent>">...</article>
 *
 * Like Realness itemids, ids start with the owner's phone when one is known;
 * without one they start at /sessions.
 * The entry `type` is the itemtype, its `id` the itemid, and a string `parentId`
 * a link to the parent row. Every other value keeps its JSON type:
 * strings are <span>, or <pre> when they span lines; numbers, booleans and null
 * are <data value>; objects are <div itemscope>; arrays are <ol> of <li>.
 * Newlines and control characters become character references, so a row is
 * always exactly one line and files can be appended a row at a time.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const ROOT = "/sessions";
const OWNER = /^\+\d+$/;

// A lone UTF-16 surrogate has no UTF-8 encoding; it is written as a reference so it survives.
const LONE_SURROGATE = "[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]";
const TEXT_SPECIAL = new RegExp(`[&<>\\u0000-\\u0008\\u000a-\\u001f\\u007f]|${LONE_SURROGATE}`, "g");
const ATTRIBUTE_SPECIAL = new RegExp(`[&"<>\\u0000-\\u0008\\u000a-\\u001f\\u007f]|${LONE_SURROGATE}`, "g");
const NAMED: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const reference = (character: string) => NAMED[character] ?? `&#${character.charCodeAt(0)};`;
const escapeText = (value: string) => value.replace(TEXT_SPECIAL, reference);
const escapeAttribute = (value: string) => value.replace(ATTRIBUTE_SPECIAL, reference);

const DECODE: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"' };
const decodeReferences = (value: string) =>
	value.replace(/&(amp|lt|gt|quot|#\d+);/g, (_, name: string) =>
		name.startsWith("#") ? String.fromCharCode(Number(name.slice(1))) : DECODE[name],
	);

const literal = (value: number | boolean | null) => (Object.is(value, -0) ? "-0" : JSON.stringify(value));
const segment = (id: string) => encodeURIComponent(id);
const lastSegment = (path: string) => decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));

/**
 * Turns a reference value into the href of the row it points at. Given the key path
 * and the value, return the full href, or undefined to write the value normally.
 */
export type LinkResolver = (path: readonly string[], value: string) => string | undefined;

function writeValue(
	key: string | undefined,
	value: JsonValue,
	links: LinkResolver | null,
	path: readonly string[],
): string {
	if (links && key !== undefined && (typeof value === "string" || typeof value === "number")) {
		const href = links([...path, key], String(value));
		if (href !== undefined) return `<link itemprop="${escapeAttribute(key)}" href="${escapeAttribute(href)}">`;
	}
	const prop = key === undefined ? "" : ` itemprop="${escapeAttribute(key)}"`;
	if (typeof value === "string")
		return value.includes("\n")
			? `<pre${prop}>${escapeText(value)}</pre>`
			: `<span${prop}>${escapeText(value)}</span>`;
	if (value === null || typeof value === "number" || typeof value === "boolean") {
		if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`Not a JSON number: ${value}`);
		return `<data${prop} value="${literal(value)}"></data>`;
	}
	if (Array.isArray(value))
		return `<ol${prop}>${value.map((item) => `<li>${writeValue(undefined, item, links, path)}</li>`).join("")}</ol>`;
	if (typeof value === "object") return `<div${prop} itemscope>${writeProps(value, new Set(), links, path)}</div>`;
	throw new Error(`Not a JSON value: ${typeof value}`);
}

function writeProps(
	object: JsonObject,
	skip: ReadonlySet<string>,
	links: LinkResolver | null,
	path: readonly string[],
): string {
	let html = "";
	for (const [key, value] of Object.entries(object)) if (!skip.has(key)) html += writeValue(key, value, links, path);
	return html;
}

/**
 * One entry as one row. Entries name their session; the header names itself.
 * `links` lets a writer mark reference values as `<link>` to other rows, using the
 * same codec both runtimes share; leave null to write plain values.
 */
export function entryToHtmlLine(entry: JsonObject, sessionId: string, owner?: string, links?: LinkResolver): string {
	if (owner !== undefined && !OWNER.test(owner))
		throw new Error(`Owner must be a phone like +14155550100, not ${owner}`);
	const typed = typeof entry.type === "string";
	const identified = typeof entry.id === "string";
	const header = entry.type === "session";
	const session = `${owner ? `/${owner}` : ""}${ROOT}/${segment(header && identified ? (entry.id as string) : sessionId)}`;
	let html = `<article itemscope itemtype="${ROOT}${typed ? `/${escapeAttribute(entry.type as string)}` : ""}"`;
	if (identified)
		html += ` itemid="${escapeAttribute(header ? session : `${session}/${segment(entry.id as string)}`)}"`;
	html += ">";
	for (const [key, value] of Object.entries(entry)) {
		if ((key === "type" && typed) || (key === "id" && identified)) continue;
		if (key === "parentId" && typeof value === "string")
			html += `<link itemprop="parentId" href="${escapeAttribute(`${session}/${segment(value)}`)}">`;
		else html += writeValue(key, value, links ?? null, []);
	}
	return `${html}</article>`;
}

function define(target: JsonObject, key: string, value: JsonValue) {
	// defineProperty keeps a key such as "__proto__" an ordinary property.
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Reads exactly the markup entryToHtmlLine writes; anything else throws. */
class RowReader {
	private at = 0;
	private readonly line: string;
	private readonly numericRefs: ReadonlySet<string> | null;

	constructor(line: string, numericRefs: ReadonlySet<string> | null = null) {
		this.line = line;
		this.numericRefs = numericRefs;
	}

	private fail(expected: string): never {
		throw new Error(
			`Not a session row: expected ${expected} at ${this.at}: ${this.line.slice(this.at, this.at + 40)}`,
		);
	}

	private take(text: string): boolean {
		if (!this.line.startsWith(text, this.at)) return false;
		this.at += text.length;
		return true;
	}

	private expect(text: string) {
		if (!this.take(text)) this.fail(JSON.stringify(text));
	}

	private until(stop: string): string {
		const end = this.line.indexOf(stop, this.at);
		if (end < 0) this.fail(JSON.stringify(stop));
		const raw = this.line.slice(this.at, end);
		this.at = end + stop.length;
		return decodeReferences(raw);
	}

	private attribute(name: string): string | undefined {
		return this.take(` ${name}="`) ? this.until('"') : undefined;
	}

	row(): JsonObject {
		this.expect(`<article itemscope itemtype="`);
		const itemtype = this.until('"');
		const itemid = this.attribute("itemid");
		this.expect(">");
		const entry: JsonObject = {};
		if (itemtype !== ROOT) {
			if (!itemtype.startsWith(`${ROOT}/`)) this.fail(`an itemtype under ${ROOT}`);
			entry.type = itemtype.slice(ROOT.length + 1);
		}
		if (itemid !== undefined) entry.id = lastSegment(itemid);
		this.props(entry, "</article>", []);
		if (this.at !== this.line.length) this.fail("the end of the row");
		return entry;
	}

	private props(target: JsonObject, close: string, path: readonly string[]) {
		while (!this.take(close)) {
			const { key, value } = this.element(true, path);
			define(target, key as string, value);
		}
	}

	private element(named: boolean, path: readonly string[]): { key?: string; value: JsonValue } {
		const tag = /^<(span|pre|data|link|div|ol)\b/.exec(this.line.slice(this.at, this.at + 6))?.[1];
		if (!tag) this.fail("a value element");
		this.at += tag.length + 1;
		const key = this.attribute("itemprop");
		if (named !== (key !== undefined)) this.fail(named ? "itemprop" : "no itemprop inside a list");
		const childPath = key === undefined ? path : [...path, key];
		switch (tag) {
			case "span":
			case "pre":
				this.expect(">");
				return { key, value: this.until(`</${tag}>`) };
			case "data": {
				const value = this.attribute("value");
				if (value === undefined) this.fail("a value attribute");
				this.expect("></data>");
				return { key, value: JSON.parse(value) as JsonValue };
			}
			case "link": {
				const href = this.attribute("href");
				if (href === undefined || !named) this.fail("a named link with href");
				this.expect(">");
				const value = lastSegment(href);
				return this.numeric(childPath) && /^\d+$/.test(value) ? { key, value: Number(value) } : { key, value };
			}
			case "div": {
				this.expect(" itemscope>");
				const object: JsonObject = {};
				this.props(object, "</div>", childPath);
				return { key, value: object };
			}
			default: {
				this.expect(">");
				const list: JsonValue[] = [];
				while (!this.take("</ol>")) {
					this.expect("<li>");
					list.push(this.element(false, childPath).value);
					this.expect("</li>");
				}
				return { key, value: list };
			}
		}
	}

	private numeric(path: readonly string[]): boolean {
		if (this.numericRefs === null) return false;
		for (let i = path.length; i >= 1; i--) if (this.numericRefs.has(path.slice(0, i).join("."))) return true;
		return false;
	}
}

/**
 * Read one row. `numericRefs` lists dotted key paths (for example `conversationId`,
 * `owner.conversationId`) whose `<link>` values are numeric ids and should read back
 * as numbers, the reverse of a writer's `LinkResolver`.
 */
export function htmlLineToEntry(line: string, numericRefs: ReadonlySet<string> | null = null): JsonObject {
	return new RowReader(line, numericRefs).row();
}

/**
 * A JSONL session as HTML Lines. Entries before any header (fragments) take
 * `sessionId`, usually the id in the file name.
 */
export function sessionJsonlToHtml(jsonl: string, sessionId: string, owner?: string): string {
	let session = sessionId;
	let html = "";
	for (const [index, line] of jsonl.split("\n").entries()) {
		if (!line.trim()) continue;
		let entry: JsonObject;
		try {
			entry = JSON.parse(line) as JsonObject;
		} catch {
			throw new Error(`Line ${index + 1} is not JSON`);
		}
		if (entry.type === "session" && typeof entry.id === "string") session = entry.id;
		html += `${entryToHtmlLine(entry, session, owner)}\n`;
	}
	return html;
}

export function sessionHtmlToEntries(html: string): JsonObject[] {
	return html
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => htmlLineToEntry(line));
}
