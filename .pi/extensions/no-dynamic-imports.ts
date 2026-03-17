/**
 * No Dynamic Imports Extension
 *
 * Blocks dynamic imports (import() or await import()) in write and edit operations.
 * Dynamic imports should be replaced with static imports at the top of files.
 *
 * Ported from .opencode/plugin/no-dynamic-imports.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

const dynamicImportPattern = /\bimport\s*\(/;

const errorMessage = `Dynamic imports are not allowed in this codebase.

Use static imports at the top of the file instead:

❌ Bad:
  const { foo } = await import("./bar");

✅ Good:
  import { foo } from "./bar";

If you need conditional imports, consider refactoring the code structure.`;

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (isToolCallEventType("write", event)) {
			if (dynamicImportPattern.test(event.input.content)) {
				return { block: true, reason: errorMessage };
			}
		}

		if (isToolCallEventType("edit", event)) {
			if (dynamicImportPattern.test(event.input.newText)) {
				return { block: true, reason: errorMessage };
			}
		}
	});
}
