import { describe, expect, test } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";

const MAX_VISIBLE_BUILTIN_COMMANDS = 20;

describe("builtin slash commands", () => {
	test("keeps the palette within its cap", () => {
		const visible = BUILTIN_SLASH_COMMANDS.filter((command) => !command.hidden);
		expect(visible.length).toBeLessThanOrEqual(MAX_VISIBLE_BUILTIN_COMMANDS);
	});
});
