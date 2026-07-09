import { z } from "zod";
import { errorMessage } from "../errors.js";
import type { ExecScope } from "../exec/exec-engine.js";
import { runExecCode } from "../exec/exec-engine.js";
import {
	diffSnapshots,
	renderSnapshotDiff,
} from "../snapshot/diff-snapshots.js";
import { waitForPageStable } from "../snapshot/wait-for-page-stable.js";
import type { SessionRegistry } from "../session-registry.js";
import type { BrowserTool, ToolResult } from "../tool.js";

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
	pageId: z
		.string()
		.optional()
		.describe(
			'Optional page ID from browser_status. Defaults to the most recently opened tab.',
		),
});

export type ExecToolInput = z.infer<typeof execInputSchema>;

export interface ExecToolOutput {
	result: unknown;
	stdout: string;
	stderr: string;
	/** Rendered a11y-tree diff since the previous exec on this session; empty when unchanged. */
	snapshotDiff: string;
}

/**
 * The concrete zod schema type is preserved (rather than widened to
 * StandardSchemaV1) so framework adapters like ai-sdk can pass it straight
 * through as their own schema input.
 */
export interface ExecTool extends BrowserTool<ExecToolInput, ExecToolOutput> {
	inputSchema: typeof execInputSchema;
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
			"stdout/stderr. Successful execs also return `snapshotDiff` — a compact " +
			"text diff of accessibility-tree changes since the previous exec (empty when " +
			"unchanged). Failures come back as `{ ok: false, error }` — read the error, " +
			"fix the code, and try again.",
		inputSchema: execInputSchema,
		async execute({ sessionId, code, pageId }): Promise<ToolResult<ExecToolOutput>> {
			let scope: ExecScope;
			try {
				const page = registry.getCurrentPage(sessionId, pageId);
				const context = page.context();
				const browser = context.browser();
				if (!browser) {
					return {
						ok: false,
						error:
							`Session "${sessionId}" is no longer connected to a browser. ` +
							"Call browser_close if you still have this session ID, then browser_open " +
							"to start a fresh session.",
					};
				}
				scope = { page, context, browser };
			} catch (err) {
				return {
					ok: false,
					error:
						`${errorMessage(err)}. Call browser_open to get a session ID, ` +
						"then pass it to browser_exec.",
				};
			}

			registry.clearBlockedNavigationError(scope.page);
			const before = await registry.readSnapshotBaseline(sessionId, pageId);
			const execResult = await runExecCode(code, scope);
			if (!execResult.ok) {
				const policyError = registry.consumeBlockedNavigationError(scope.page);
				if (policyError) throw policyError;
				return execResult;
			}
			registry.clearBlockedNavigationError(scope.page);

			let snapshotDiff = "";
			try {
				await waitForPageStable(scope.page);
				const after = await registry.captureSnapshotAfterExec(sessionId, pageId);
				snapshotDiff = renderSnapshotDiff(diffSnapshots(before, after));
			} catch {
				registry.clearSnapshotCache(sessionId);
			}

			return { ...execResult, snapshotDiff };
		},
	};
}
