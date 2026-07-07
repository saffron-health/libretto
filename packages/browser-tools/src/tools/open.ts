import { z } from "zod";
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

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
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
						error: `Failed to navigate to ${url}: ${describeError(err)}`,
					};
				}
			}
			return { ok: true, sessionId };
		},
	};
}
