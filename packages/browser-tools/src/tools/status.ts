import { z } from "zod";
import { errorMessage } from "../errors.js";
import type { PageStatus, SessionPageSummary, SessionSummary } from "../session-registry.js";
import type { SessionRegistry } from "../session-registry.js";
import type { BrowserTool, ToolResult } from "../tool.js";

const statusInputSchema = z.object({
	sessionId: z
		.string()
		.optional()
		.describe('Session ID from browser_open or browser_connect, e.g. "ses-4f2a".'),
	pageId: z
		.string()
		.optional()
		.describe('Page ID from browser_status, e.g. "page-a1b2".'),
});

export type StatusToolInput = z.infer<typeof statusInputSchema>;

export interface StatusAllOutput {
	sessions: SessionSummary[];
}

export interface StatusSessionOutput {
	pages: SessionPageSummary[];
}

export type StatusToolOutput =
	| StatusAllOutput
	| StatusSessionOutput
	| PageStatus;

export interface StatusTool extends BrowserTool<StatusToolInput, StatusToolOutput> {
	inputSchema: typeof statusInputSchema;
}

export function createStatusTool(registry: SessionRegistry): StatusTool {
	return {
		name: "browser_status",
		description:
			"Inspect open browser sessions and pages. Call with no args to list all " +
			"sessions and their pages; with `sessionId` to list pages in one session; " +
			"with `sessionId` and `pageId` for url, title, viewport, and loading state. " +
			"When confused about which tab to target, start here.",
		inputSchema: statusInputSchema,
		async execute({
			sessionId,
			pageId,
		}): Promise<ToolResult<StatusToolOutput>> {
			if (pageId !== undefined && sessionId === undefined) {
				return {
					ok: false,
					error:
						"pageId requires sessionId. Call browser_status with sessionId only " +
						"to list pages for that session.",
				};
			}

			if (sessionId === undefined) {
				return { ok: true, sessions: registry.listSessions() };
			}

			if (pageId === undefined) {
				const session = registry
					.listSessions()
					.find((entry) => entry.sessionId === sessionId);
				if (!session) {
					return {
						ok: false,
						error:
							`Unknown session ID: ${sessionId}. Call browser_open to get a ` +
							"session ID, or browser_status with no args to list open sessions.",
					};
				}
				return { ok: true, pages: session.pages };
			}

			try {
				return {
					ok: true,
					...(await registry.getPageStatus(sessionId, pageId)),
				};
			} catch (err) {
				return {
					ok: false,
					error:
						`${errorMessage(err)}. Call browser_status with sessionId only ` +
						"to list open pages for that session.",
				};
			}
		},
	};
}
