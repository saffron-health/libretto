import { tool, type ToolSet } from "ai";
import { createBrowserTools } from "../../create-browser-tools.js";
import type { BrowserProvider } from "../../provider.js";
import { snapshotToModelOutput } from "./snapshot-to-model-output.js";

/**
 * AI SDK adapter: wraps the base tools into `ai` package tools for use
 * with `generateText` / `streamText`. The base tools expose concrete zod
 * schemas, which the AI SDK accepts directly as `inputSchema`.
 */
export function createAiSdkBrowserTools(provider: BrowserProvider): {
	tools: ToolSet;
	dispose(): Promise<void>;
} {
	const base = createBrowserTools(provider);
	const { browser_open, browser_exec, browser_snapshot } = base.tools;
	return {
		tools: {
			browser_open: tool({
				description: browser_open.description,
				inputSchema: browser_open.inputSchema,
				execute: (input) => browser_open.execute(input),
			}),
			browser_exec: tool({
				description: browser_exec.description,
				inputSchema: browser_exec.inputSchema,
				execute: (input) => browser_exec.execute(input),
			}),
			browser_snapshot: tool({
				description: browser_snapshot.description,
				inputSchema: browser_snapshot.inputSchema,
				execute: (input) => browser_snapshot.execute(input),
				toModelOutput: snapshotToModelOutput,
			}),
		},
		dispose: base.dispose,
	};
}
