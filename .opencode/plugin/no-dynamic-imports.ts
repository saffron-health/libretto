import type { Plugin } from "@opencode-ai/plugin";

/**
 * Plugin to prevent dynamic imports in the codebase.
 * Dynamic imports (import() or await import()) should be replaced with static imports at the top of files.
 */
export const NoDynamicImports: Plugin = async () => {
	// Match import() calls, including with await and optional whitespace
	// Note: No /g flag - we just need to check if pattern exists, not find all matches
	const dynamicImportPattern = /\bimport\s*\(/;

	const errorMessage = `Dynamic imports are not allowed in this codebase.

Use static imports at the top of the file instead:

❌ Bad:
  const { foo } = await import("./bar");

✅ Good:
  import { foo } from "./bar";

If you need conditional imports, consider refactoring the code structure.`;

	return {
		"tool.execute.before": async (input, output) => {
			const { tool } = input;
			const { args } = output;

			// Check write operations
			if (tool === "write") {
				if (dynamicImportPattern.test(args.content)) {
					throw new Error(errorMessage);
				}
			}

			// Check edit operations
			if (tool === "edit") {
				if (dynamicImportPattern.test(args.newString)) {
					throw new Error(errorMessage);
				}
			}

			// Check multiedit operations
			if (tool === "multiedit") {
				for (const edit of args.edits) {
					if (dynamicImportPattern.test(edit.newString)) {
						throw new Error(errorMessage);
					}
				}
			}

			// Check apply_patch operations
			if (tool === "apply_patch") {
				if (dynamicImportPattern.test(args.patchText)) {
					throw new Error(errorMessage);
				}
			}
		},
	};
};
