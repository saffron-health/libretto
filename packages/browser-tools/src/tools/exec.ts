import { z } from "zod";
import { errorMessage } from "../errors.js";
import type { ExecScope } from "../exec/exec-engine.js";
import { runExecCode } from "../exec/exec-engine.js";
import {
	diffSnapshots,
	renderSnapshotDiff,
} from "../snapshot/diff-snapshots.js";
import {
	waitForPageStable,
	type PageStabilityWaitOptions,
} from "../snapshot/wait-for-page-stable.js";
import type { SessionRegistry } from "../session-registry.js";
import type { BrowserToolTimingEvent } from "../create-browser-tools.js";
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

export type ExecToolOutput = {
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
export type ExecTool = {
	inputSchema: typeof execInputSchema;
} & BrowserTool<ExecToolInput, ExecToolOutput>

export function createExecTool(
	registry: SessionRegistry,
	pageStability: PageStabilityWaitOptions = {},
	onTiming?: (event: BrowserToolTimingEvent) => void | Promise<void>,
	captureSnapshotDiff = true,
): ExecTool {
	return {
		name: "browser_exec",
		description:
			"Run Playwright code against an open browser session. The code runs as " +
			"the body of an async function — use `return` to produce a result. " +
			"Nothing persists between calls (no variables, no imports); the browser " +
			"itself is the only state. In scope: `page` (the current playwright " +
			"Page), `context` (BrowserContext), `browser` (Browser). TypeScript is " +
			"fine. `console.log`/`console.error` output is captured and returned as " +
			"stdout/stderr. " +
			(captureSnapshotDiff
				? "Successful execs also return `snapshotDiff` — a compact text diff of accessibility-tree changes since the previous exec (empty when unchanged). "
				: "Call browser_snapshot after an exec when you need to inspect or verify page changes. ") +
			"Failures come back as `{ ok: false, error }` — read the error, " +
			"fix the code, and try again.",
		inputSchema: execInputSchema,
		async execute({ sessionId, code, pageId }): Promise<ToolResult<ExecToolOutput>> {
			const startedAt = Date.now();
			const phases: Record<string, number> = {};
			const emitTiming = async (outcome: "success" | "error") => {
				await Promise.resolve(
					onTiming?.({
						tool: "browser_exec",
						durationMs: Date.now() - startedAt,
						phases,
						outcome,
					}),
				).catch(() => undefined);
			};
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

			let before:
				| Awaited<ReturnType<SessionRegistry["readSnapshotBaseline"]>>
				| undefined;
			if (captureSnapshotDiff) {
				const baselineStartedAt = Date.now();
				before = await registry.readSnapshotBaseline(sessionId, pageId);
				phases.baselineSnapshotMs = Date.now() - baselineStartedAt;
			}
			const executionStartedAt = Date.now();
			const execResult = await runExecCode(code, scope);
			phases.executionMs = Date.now() - executionStartedAt;
			const executionPolicyError = registry.consumeBlockedNavigationError(
				scope.page,
			);
			if (executionPolicyError) throw executionPolicyError;
			if (!execResult.ok) {
				await emitTiming("error");
				return execResult;
			}
			if (!captureSnapshotDiff || !before) {
				await emitTiming("success");
				return { ...execResult, snapshotDiff: "" };
			}

			let snapshotDiff = "";
			try {
				const stabilityStartedAt = Date.now();
				await waitForPageStable(scope.page, pageStability);
				phases.stabilityMs = Date.now() - stabilityStartedAt;
				const snapshotStartedAt = Date.now();
				const after = await registry.captureSnapshotAfterExec(sessionId, pageId);
				phases.snapshotMs = Date.now() - snapshotStartedAt;
				const diffStartedAt = Date.now();
				snapshotDiff = renderSnapshotDiff(diffSnapshots(before, after));
				phases.diffMs = Date.now() - diffStartedAt;
			} catch {
				registry.clearSnapshotCache(sessionId);
			}
			const stabilizationPolicyError =
				registry.consumeBlockedNavigationError(scope.page);
			if (stabilizationPolicyError) throw stabilizationPolicyError;

			await emitTiming("success");
			return { ...execResult, snapshotDiff };
		},
	};
}
