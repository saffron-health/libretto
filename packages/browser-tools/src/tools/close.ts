import { z } from "zod";
import { errorMessage } from "../errors.js";
import type { SessionRegistry } from "../session-registry.js";
import type { BrowserTool, ToolResult } from "../tool.js";

const closeInputSchema = z.object({
	sessionId: z
		.string()
		.describe('Session ID returned by browser_open or browser_connect, e.g. "ses-4f2a".'),
});

export type CloseToolInput = z.infer<typeof closeInputSchema>;

export type CloseToolOutput = {};

export interface CloseTool extends BrowserTool<CloseToolInput, CloseToolOutput> {
	inputSchema: typeof closeInputSchema;
}

export function createCloseTool(registry: SessionRegistry): CloseTool {
	return {
		name: "browser_close",
		description:
			"Close a browser session by session ID. For provider-owned sessions this " +
			"releases the remote browser; for browser_connect sessions it detaches " +
			"without killing the externally managed browser.",
		inputSchema: closeInputSchema,
		async execute({ sessionId }): Promise<ToolResult<CloseToolOutput>> {
			try {
				await registry.closeSession(sessionId);
				return { ok: true };
			} catch (err) {
				return {
					ok: false,
					error:
						`${errorMessage(err)}. Call browser_status with no args to list ` +
						"open sessions, or browser_open to start a new one.",
				};
			}
		},
	};
}
