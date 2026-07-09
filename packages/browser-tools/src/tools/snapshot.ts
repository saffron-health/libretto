import { z } from "zod";
import { snapshot as captureSnapshot } from "../snapshot/capture-snapshot.js";
import { renderSnapshot } from "../snapshot/render-snapshot.js";
import { waitForPageStable } from "../snapshot/wait-for-page-stable.js";
import { errorMessage } from "../errors.js";
import type { SessionRegistry } from "../session-registry.js";
import type { BrowserTool, ToolResult } from "../tool.js";

const snapshotInputSchema = z.object({
	sessionId: z
		.string()
		.describe('Session ID returned by browser_open, e.g. "ses-4f2a".'),
	screenshot: z
		.boolean()
		.optional()
		.describe("When true, also return a PNG screenshot as base64 bytes."),
	pageId: z
		.string()
		.optional()
		.describe(
			'Optional page ID from browser_status. Defaults to the most recently opened tab.',
		),
});

export type SnapshotToolInput = z.infer<typeof snapshotInputSchema>;

export interface SnapshotScreenshot {
	base64: string;
	mimeType: "image/png";
}

export interface SnapshotToolOutput {
	tree: string;
	screenshot?: SnapshotScreenshot;
}

export interface SnapshotTool
	extends BrowserTool<SnapshotToolInput, SnapshotToolOutput> {
	inputSchema: typeof snapshotInputSchema;
}

export function createSnapshotTool(registry: SessionRegistry): SnapshotTool {
	return {
		name: "browser_snapshot",
		description:
			"Capture the current page as a compact text accessibility tree with " +
			"`ref` handles for targeting elements in browser_exec. Set " +
			"`screenshot: true` to also receive PNG bytes (base64 + mimeType). " +
			"Use this to orient before interacting, or to verify what changed after exec.",
		inputSchema: snapshotInputSchema,
		async execute({
			sessionId,
			screenshot,
			pageId,
		}): Promise<ToolResult<SnapshotToolOutput>> {
			let page;
			try {
				page = registry.getCurrentPage(sessionId, pageId);
			} catch (err) {
				return {
					ok: false,
					error:
						`${errorMessage(err)}. Call browser_open to get a session ID, ` +
						"then pass it to browser_snapshot.",
				};
			}

			try {
				await waitForPageStable(page);
				const raw = await captureSnapshot(page);
				const tree = renderSnapshot(raw);
				const output: SnapshotToolOutput = { tree };

				if (screenshot) {
					const bytes = await page.screenshot({ type: "png" });
					output.screenshot = {
						base64: bytes.toString("base64"),
						mimeType: "image/png",
					};
				}

				return { ok: true, ...output };
			} catch (err) {
				return {
					ok: false,
					error:
						`Could not capture a snapshot (${errorMessage(err)}). ` +
						"Try browser_status to see open pages, or browser_open if the session ended.",
				};
			}
		},
	};
}
