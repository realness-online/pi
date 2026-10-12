/**
 * Tests never write to the real home directory. Every run gets its own agent
 * folder (PI_CODING_AGENT_DIR in vitest.base.ts); this guard fails the run if
 * `~/.pi` appears anyway, so a leak is caught the run it happens.
 */
import { existsSync as exists } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const home_pi = join(homedir(), ".pi");

export default function setup() {
	const before = exists(home_pi);
	return () => {
		if (!before && exists(home_pi)) {
			// Vitest logs a teardown throw but still exits 0; the exit code is what CI reads.
			console.error(`A test wrote to ${home_pi}. Give it a temp agentDir or sessionDir; then remove ${home_pi}.`);
			process.exitCode = 1;
		}
	};
}
