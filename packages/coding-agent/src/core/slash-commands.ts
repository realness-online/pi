import { APP_NAME } from "../config.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
	/** Typed commands still run; the palette hides them. */
	hidden?: boolean;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
	argumentHint?: string;
	/** Typed commands still run; the palette hides them. */
	hidden?: boolean;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu", hidden: true },
	{ name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>" },
	{ name: "tree", description: "Navigate session tree (switch branches)", hidden: true },
	{ name: "thinking", description: "Set thinking level", argumentHint: "<level>", hidden: true },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling", hidden: true },
	{
		name: "export",
		description: "Export session (HTML page by default, or a path ending .html, .html.gz, or .jsonl)",
		hidden: true,
	},
	{
		name: "import",
		description: "Import a session (.html.gz or .jsonl), preserving its ID and working directory",
		hidden: true,
	},
	{ name: "share", description: "Share session via a Radius artifact or a GitHub gist", hidden: true },
	{ name: "bug", description: "Report a bug to the Pi developers", argumentHint: "<description>", hidden: true },
	{ name: "copy", description: "Copy last agent message to clipboard", hidden: true },
	{ name: "name", description: "Set session display name", hidden: true },
	{ name: "session", description: "Show session info and stats", hidden: true },
	{ name: "changelog", description: "Show changelog entries", hidden: true },
	{ name: "hotkeys", description: "Show all keyboard shortcuts", hidden: true },
	{ name: "fork", description: "Create a new fork from a previous user message", hidden: true },
	{ name: "clone", description: "Duplicate the current session at the current position", hidden: true },
	{ name: "trust", description: "Save project trust decision for future sessions", hidden: true },
	{ name: "login", description: "Configure provider authentication", argumentHint: "<provider>", hidden: true },
	{ name: "logout", description: "Remove provider authentication", hidden: true },
	{ name: "new", description: "Start a new session" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "resume", description: "Resume another session" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, themes, and context files" },
	{ name: "quit", description: `Quit ${APP_NAME}`, hidden: true },
];
