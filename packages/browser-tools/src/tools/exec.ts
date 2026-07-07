import { z } from "zod";
import type { ExecResult, ExecScope } from "../exec/exec-engine.js";
import { runExecCode } from "../exec/exec-engine.js";
import type { SessionRegistry } from "../session-registry.js";
import type { BrowserTool } from "../tool.js";

const execInputSchema = z.object({
	sessionId: z
		.string()
		.describe('Session ID returned by browser_open, e.g. "ses-4f2a".'),
	code: z
		.string()
		.describe(
			"Playwright code to run against the session. Runs as the body of an " +
				"async function — use `return` to produce a result.",
		),
});

export type ExecToolInput = z.infer<typeof execInputSchema>;

export interface ExecToolOutput {
	result: unknown;
	stdout: string;
	stderr: string;
}

/**
 * The concrete zod schema type is preserved (rather than widened to
 * StandardSchemaV1) so framework adapters like ai-sdk can pass it straight
 * through as their own schema input.
 */
export interface ExecTool extends BrowserTool<ExecToolInput, ExecToolOutput> {
	inputSchema: typeof execInputSchema;
}

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function createExecTool(registry: SessionRegistry): ExecTool {
	return {
		name: "browser_exec",
		description:
			"Run Playwright code against an open browser session. The code runs as " +
			"the body of an async function — use `return` to produce a result. " +
			"Nothing persists between calls (no variables, no imports); the browser " +
			"itself is the only state. In scope: `page` (the current playwright " +
			"Page), `context` (BrowserContext), `browser` (Browser). TypeScript is " +
			"fine. `console.log`/`console.error` output is captured and returned as " +
			"stdout/stderr. Failures come back as `{ ok: false, error }` — read the " +
			"error, fix the code, and try again.",
		inputSchema: execInputSchema,
		async execute({ sessionId, code }): Promise<ExecResult> {
			let scope: ExecScope;
			try {
				const page = registry.getCurrentPage(sessionId);
				const context = page.context();
				const browser = context.browser();
				if (!browser) {
					return {
						ok: false,
						error: `Session "${sessionId}" has no connected browser.`,
					};
				}
				scope = { page, context, browser };
			} catch (err) {
				return {
					ok: false,
					error: `${describeError(err)}. Call browser_open first to get a session ID.`,
				};
			}
			return runExecCode(code, scope);
		},
	};
}
