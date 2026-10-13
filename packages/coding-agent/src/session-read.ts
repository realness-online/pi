#!/usr/bin/env node
import { readFileSync as read_file_sync } from "node:fs";
import { read_session_gzip } from "./core/session-gzip.ts";
import { htmlLineToEntry as html_line_to_entry } from "./core/session-html.ts";

const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length) throw new Error("Usage: pi-session-read <session.jsonl|session.html|session.html.gz>");
const bytes = read_file_sync(file);
if (file.endsWith(".jsonl")) process.stdout.write(bytes);
else if (file.endsWith(".html") || file.endsWith(".html.gz")) {
	const text = file.endsWith(".gz") ? read_session_gzip(bytes).text : bytes.toString("utf8");
	const lines = text.split("\n");
	for (const [index, line] of lines.entries()) {
		if (!line.trim()) continue;
		// Only an unfinished final article can be a live writer's partial row.
		if (index === lines.length - 1 && line.startsWith("<article ") && !line.endsWith("</article>")) break;
		process.stdout.write(`${JSON.stringify(html_line_to_entry(line))}\n`);
	}
} else throw new Error(`Unsupported session file: ${file}`);
