/**
 * Model-Aware Tools Extension
 *
 * Swaps the edit tool based on the active model:
 *   - Anthropic/Claude models: use Pi's built-in `edit` (oldText/newText replacement)
 *   - OpenAI/GPT models: replace `edit` with `apply_patch` (Codex patch format)
 *
 * The apply_patch tool uses the same patch format as OpenAI Codex:
 *   https://github.com/openai/codex
 *
 * GPT models are trained to produce this format, while Claude models work better
 * with the find-and-replace style edit tool.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { applyPatch } from "./patch";

function isOpenAIModel(provider: string): boolean {
	return provider === "openai" || provider === "azure-openai";
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "apply_patch",
		label: "Apply Patch",
		description:
			"Apply a patch to create, update, move, or delete files. Uses a concise patch format with context lines for matching.",
		promptGuidelines: [
			`Use the apply_patch tool to edit files. The patch format uses \`*** Begin Patch\` / \`*** End Patch\` markers with file operations inside.`,
			`File operations: \`*** Add File: <path>\` (new file, lines prefixed with +), \`*** Delete File: <path>\`, \`*** Update File: <path>\` (with optional \`*** Move to: <path>\`).`,
			`Update hunks start with \`@@\` (optionally followed by a context header like a class/function name). Lines start with \` \` (context), \`-\` (remove), or \`+\` (add).`,
			`Include ~3 lines of context before and after each change. Use \`@@ className\` or \`@@ methodName\` headers if context lines alone aren't unique enough.`,
			`File paths must be relative, NEVER absolute.`,
			`Example:\n\`\`\`\n*** Begin Patch\n*** Update File: src/app.ts\n@@ function main()\n import { foo } from "./foo";\n-console.log("old");\n+console.log("new");\n import { bar } from "./bar";\n*** End Patch\n\`\`\``,
		],
		parameters: Type.Object({
			patch: Type.String({
				description: "The patch text in Codex patch format (*** Begin Patch ... *** End Patch)",
			}),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { patch } = params;
			const result = applyPatch(patch, ctx.cwd);
			return {
				content: [{ type: "text", text: result }],
				details: { patch },
			};
		},
	});

	function syncToolsForModel(provider: string) {
		const currentTools = pi.getActiveTools();
		const usePatching = isOpenAIModel(provider);

		if (usePatching) {
			// OpenAI: enable apply_patch, disable edit and write
			const tools = currentTools.filter((t) => t !== "edit" && t !== "write");
			if (!tools.includes("apply_patch")) tools.push("apply_patch");
			pi.setActiveTools(tools);
		} else {
			// Anthropic/others: enable edit and write, disable apply_patch
			const tools = currentTools.filter((t) => t !== "apply_patch");
			if (!tools.includes("edit")) tools.push("edit");
			if (!tools.includes("write")) tools.push("write");
			pi.setActiveTools(tools);
		}
	}

	pi.on("model_select", async (event) => {
		syncToolsForModel(event.model.provider);
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.model) {
			syncToolsForModel(ctx.model.provider);
		}
	});
}
