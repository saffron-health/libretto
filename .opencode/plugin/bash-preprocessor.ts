import type { Plugin } from "@opencode-ai/plugin";

export const BashPreprocessor: Plugin = async ({ directory }) => {
	const repoPath = directory;

	return {
		"tool.execute.before": async (input, output) => {
			if (input.tool === "bash" && output.args?.command) {
				let command = output.args.command as string;

				// Escape special regex characters in the repo path
				const escapedRepoPath = repoPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

				// Pattern 1: Remove "cd <repo-path> && " from the start
				const cdPrefixRegex = new RegExp(`^cd\\s+${escapedRepoPath}\\s+&&\\s+`);
				command = command.replace(cdPrefixRegex, "");

				// Pattern 2: Replace all occurrences of absolute repo path with relative path
				// This handles cases like /path/to/repo/src/... -> src/...
				const repoPathRegex = new RegExp(escapedRepoPath + "/", "g");
				command = command.replace(repoPathRegex, "");

				// Pattern 3: Replace standalone repo path (not followed by /)
				// This handles cases where the repo path appears alone (e.g., as an argument)
				const standaloneRepoPathRegex = new RegExp(
					`\\b${escapedRepoPath}\\b(?!/)`,
					"g",
				);
				command = command.replace(standaloneRepoPathRegex, ".");

				output.args.command = command;
			}
		},
	};
};
