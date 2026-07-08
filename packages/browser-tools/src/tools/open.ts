import { z } from "zod";
import { errorMessage } from "../errors.js";
import type { SessionRegistry } from "../session-registry.js";
import type { BrowserTool, ToolResult } from "../tool.js";

const openInputSchema = z.object({
	url: z
		.string()
		.optional()
		.describe("Optional URL to navigate to after the session opens."),
});

export type OpenToolInput = z.infer<typeof openInputSchema>;

export interface OpenToolOutput {
	sessionId: string;
}

/**
 * The concrete zod schema type is preserved (rather than widened to
 * StandardSchemaV1) so framework adapters like ai-sdk can pass it straight
 * through as their own schema input.
 */
export interface OpenTool extends BrowserTool<OpenToolInput, OpenToolOutput> {
	inputSchema: typeof openInputSchema;
}

export function createOpenTool(registry: SessionRegistry): OpenTool {
	return {
		name: "browser_open",
		description:
			"Open a new browser session. Optionally navigates to `url` after opening. " +
			"Returns a `sessionId` to pass to subsequent browser tools.",
		inputSchema: openInputSchema,
		async execute({ url }): Promise<ToolResult<OpenToolOutput>> {
			const { sessionId } = await registry.openSession();
			if (url !== undefined) {
				try {
					await registry.getCurrentPage(sessionId).goto(url);
				} catch (err) {
					await registry.closeSession(sessionId);
					return {
						ok: false,
						error:
							`Could not navigate to ${url} (${errorMessage(err)}). ` +
							"The session was closed. Call browser_open again — use a full https:// URL, " +
							"or omit url and navigate with browser_exec via `await page.goto(...)`.",
					};
				}
			}
			return { ok: true, sessionId };
		},
	};
}
