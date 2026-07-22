import { z } from "zod";
import { errorMessage } from "../errors.js";
import {
	browserCleanupErrorMessage,
	type SessionRegistry,
} from "../session-registry.js";
import type { BrowserTool, ToolResult } from "../tool.js";

const openInputSchema = z.object({
	url: z
		.string()
		.optional()
		.describe(
			"Optional start URL for the session. Providers that support create-time " +
				"navigation open it before CDP attach; others navigate after connect.",
		),
	authProfile: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Optional auth profile to restore for this session and save when it closes.",
		),
});

export type OpenToolInput = z.infer<typeof openInputSchema>;

export type OpenToolOutput = {
	sessionId: string;
}

/**
 * The concrete zod schema type is preserved (rather than widened to
 * StandardSchemaV1) so framework adapters like ai-sdk can pass it straight
 * through as their own schema input.
 */
export type OpenTool = {
	inputSchema: typeof openInputSchema;
} & BrowserTool<OpenToolInput, OpenToolOutput>

export function createOpenTool(registry: SessionRegistry): OpenTool {
	return {
		name: "browser_open",
		description:
			"Open a new browser session. Optionally opens `url` at session create " +
			"(or after connect when the provider cannot preload) and restores `authProfile`. " +
			"Profile changes save when the session closes. " +
			"Returns a `sessionId` to pass to subsequent browser tools.",
		inputSchema: openInputSchema,
		async execute({ url, authProfile }): Promise<ToolResult<OpenToolOutput>> {
			const startUrl = url?.trim() || undefined;
			const opened = await registry.openSession({
				authProfile,
				...(startUrl ? { startUrl } : {}),
			});
			if (opened instanceof Error) return { ok: false, error: opened.message };
			const { sessionId, startUrlPreloaded } = opened;
			if (startUrl !== undefined && !startUrlPreloaded) {
				const page = registry.getCurrentPage(sessionId);
				try {
					await page.goto(startUrl);
				} catch (err) {
					const policyError = registry.consumeBlockedNavigationError(page);
					const closeError = await registry.closeSession(sessionId);
					if (policyError) {
						if (closeError) {
							console.error(
								"Browser cleanup also failed after a blocked navigation:",
								closeError,
							);
						}
						throw policyError;
					}
					if (closeError) {
						return {
							ok: false,
							error:
								`Could not navigate to ${url} (${errorMessage(err)}). ` +
								`The session was removed, but cleanup failed: ${browserCleanupErrorMessage(closeError)}`,
						};
					}
					return {
						ok: false,
						error:
							`Could not navigate to ${startUrl} (${errorMessage(err)}). ` +
							"The session was closed. Call browser_open again — use a full https:// URL, " +
							"or omit url and navigate with browser_exec via `await page.goto(...)`.",
					};
				}
			}
			return { ok: true, sessionId };
		},
	};
}
