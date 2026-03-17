/**
 * Bash Preprocessor Extension
 *
 * Normalizes bash commands before execution:
 * - Removes unnecessary "cd <repo-path> && " prefixes
 * - Replaces absolute repo paths with relative paths
 *
 * Ported from .opencode/plugin/bash-preprocessor.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const repoPath = ctx.cwd;
		let command = event.input.command;

		// Escape special regex characters in the repo path
		const escapedRepoPath = repoPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

		// Pattern 1: Remove "cd <repo-path> && " from the start
		const cdPrefixRegex = new RegExp(`^cd\\s+${escapedRepoPath}\\s+&&\\s+`);
		command = command.replace(cdPrefixRegex, "");

		// Pattern 2: Replace all occurrences of absolute repo path with relative path
		const repoPathRegex = new RegExp(escapedRepoPath + "/", "g");
		command = command.replace(repoPathRegex, "");

		// Pattern 3: Replace standalone repo path (not followed by /)
		const standaloneRepoPathRegex = new RegExp(`\\b${escapedRepoPath}\\b(?!/)`, "g");
		command = command.replace(standaloneRepoPathRegex, ".");

		event.input.command = command;
	});
}
