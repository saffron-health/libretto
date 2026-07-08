import { z } from "zod";
import { errorMessage } from "../errors.js";
import type { SessionRegistry } from "../session-registry.js";
import type { BrowserTool, ToolResult } from "../tool.js";

const connectInputSchema = z.object({
	cdpUrl: z
		.string()
		.describe(
			"CDP websocket URL for an already-running browser, e.g. " +
				'"ws://127.0.0.1:9222/devtools/browser/...".',
		),
});

export type ConnectToolInput = z.infer<typeof connectInputSchema>;

export interface ConnectToolOutput {
	sessionId: string;
}

export interface ConnectTool
	extends BrowserTool<ConnectToolInput, ConnectToolOutput> {
	inputSchema: typeof connectInputSchema;
}

export function createConnectTool(registry: SessionRegistry): ConnectTool {
	return {
		name: "browser_connect",
		description:
			"Attach to an already-running browser via its CDP URL. Returns a session ID " +
			"like browser_open, but closing the session detaches without killing the " +
			"externally managed browser.",
		inputSchema: connectInputSchema,
		async execute({ cdpUrl }): Promise<ToolResult<ConnectToolOutput>> {
			try {
				const { sessionId } = await registry.connectSession(cdpUrl);
				return { ok: true, sessionId };
			} catch (err) {
				return {
					ok: false,
					error:
						`Could not connect to ${cdpUrl} (${errorMessage(err)}). ` +
						"Verify the CDP endpoint is reachable and try again.",
				};
			}
		},
	};
}
