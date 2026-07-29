import { z } from "zod";
import { errorMessage } from "../errors.js";
import type { ExecScope } from "../exec/exec-engine.js";
import { runExecCode } from "../exec/exec-engine.js";
import { snapshot as captureSnapshot } from "../snapshot/capture-snapshot.js";
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
	diffSnapshot: z
		.boolean()
		.optional()
		.describe(
			"When true, capture a compact accessibility-tree baseline before the exec, " +
				"wait for the page to settle after success, then return `snapshotDiff` " +
				"against a fresh after-tree. Use for exploratory mutations when you do " +
				"not know what will change. Omit or set false to skip the cost.",
		),
});

export type ExecToolInput = z.infer<typeof execInputSchema>;

export type ExecToolOutput = {
	result: unknown;
	stdout: string;
	stderr: string;
	/** Rendered a11y-tree diff when `diffSnapshot` was true; empty when off or unchanged. */
	snapshotDiff: string;
}

/**
 * The concrete zod schema type is preserved (rather than widened to
 * StandardSchemaV1) so framework adapters like ai-sdk can pass it straight
 * through as their own schema input.
 */
export type ExecTool = {
	inputSchema: typeof execInputSchema;
} & BrowserTool<ExecToolInput, ExecToolOutput>

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
			"stdout/stderr. Pass `diffSnapshot: true` to also return `snapshotDiff` — " +
			"a compact text diff of accessibility-tree changes from just before this " +
			"exec (empty when unchanged). Use that for exploratory mutations when you " +
			"do not know what will change; omit it otherwise. Failures come back as " +
			"`{ ok: false, error }` — read the error, fix the code, and try again.",
		inputSchema: execInputSchema,
		async execute({
			sessionId,
			code,
			pageId,
			diffSnapshot,
		}): Promise<ToolResult<ExecToolOutput>> {
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

			const before = diffSnapshot
				? await captureSnapshot(scope.page)
				: undefined;
			const execResult = await runExecCode(code, scope);
			const executionPolicyError = registry.consumeBlockedNavigationError(
				scope.page,
			);
			if (executionPolicyError) throw executionPolicyError;
			if (!execResult.ok) return execResult;

			// Settle after exec when the caller opted into a snapshot diff, or when
			// a domain policy may still report an unawaited blocked navigation.
			const settleAfterExec =
				Boolean(diffSnapshot) || registry.hasNonemptyDomainPolicy();

			let snapshotDiff = "";
			if (settleAfterExec) {
				try {
					await waitForPageStable(scope.page);
					if (diffSnapshot && before) {
						const after = await captureSnapshot(scope.page);
						snapshotDiff = renderSnapshotDiff(diffSnapshots(before, after));
					}
				} catch (err) {
					// Keep the successful exec result when after-diff capture fails.
					if (diffSnapshot) {
						snapshotDiff =
							`Failed to do post-diff snapshot: ${errorMessage(err)}. ` +
							"The exec itself succeeded. Call browser_snapshot if you need " +
							"the current page state, or omit diffSnapshot when the page may close.";
					}
				}
				const stabilizationPolicyError =
					registry.consumeBlockedNavigationError(scope.page);
				if (stabilizationPolicyError) throw stabilizationPolicyError;
			}

			return { ...execResult, snapshotDiff };
		},
	};
}
