#!/usr/bin/env node
import { compact_closed_session } from '../packages/coding-agent/src/core/session-compaction.ts'

const paths = process.argv.slice(2)
if (!paths.length) throw new Error('Usage: node --experimental-strip-types scripts/compact-sessions.js <session.html.gz> ...')
for (const path of paths) {
  const result = compact_closed_session(path)
  process.stdout.write(`${JSON.stringify({ path, ...result })}\n`)
}
