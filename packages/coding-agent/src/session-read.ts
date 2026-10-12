#!/usr/bin/env node
import { readFileSync as read_file_sync } from "node:fs";
import { read_session_gzip } from "./core/session-gzip.ts";
import { sessionHtmlToEntries as session_html_to_entries } from "./core/session-html.ts";

const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length) throw new Error("Usage: pi-session-read <session.jsonl|session.html|session.html.gz>");
const bytes = read_file_sync(file);
if (file.endsWith(".jsonl")) process.stdout.write(bytes);
else if (file.endsWith(".html") || file.endsWith(".html.gz")) {
	const text = file.endsWith(".gz") ? read_session_gzip(bytes).text : bytes.toString("utf8");
	for (const entry of session_html_to_entries(text)) process.stdout.write(`${JSON.stringify(entry)}\n`);
} else throw new Error(`Unsupported session file: ${file}`);
