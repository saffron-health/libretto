import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	createBrowserTools,
	type BrowserToolkitOptions,
} from "../../create-browser-tools.js";
import type { BrowserProvider } from "../../provider.js";
import type { BrowserCleanupError } from "../../session-registry.js";
import type { ToolResult } from "../../tool.js";
import type { SnapshotToolOutput } from "../../tools/snapshot.js";

export type McpBrowserToolkit = {
	dispose(): Promise<BrowserCleanupError | null>;
};

function textResult(result: unknown): CallToolResult {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(result, null, 2) ?? String(result),
			},
		],
		...(isToolError(result) ? { isError: true } : {}),
	};
}

function isToolError(result: unknown): boolean {
	return (
		typeof result === "object" &&
		result !== null &&
		"ok" in result &&
		result.ok === false
	);
}

function snapshotResult(
	result: ToolResult<SnapshotToolOutput>,
): CallToolResult {
	if (!result.ok || !result.screenshot) return textResult(result);

	const { screenshot, ...text } = result;
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						...text,
						screenshot: {
							mimeType: screenshot.mimeType,
							note: "Attached as image content.",
						},
					},
					null,
					2,
				),
			},
			{
				type: "image",
				data: screenshot.base64,
				mimeType: screenshot.mimeType,
			},
		],
	};
}

/**
 * Registers Libretto browser tools on a caller-owned MCP server.
 *
 * The caller owns the server transport and must call `dispose` when the MCP
 * connection ends. Create one toolkit per user or connection when browser
 * sessions must not be shared.
 */
export function registerMcpBrowserTools(
	server: McpServer,
	provider: BrowserProvider,
	options: BrowserToolkitOptions = {},
): McpBrowserToolkit {
	const base = createBrowserTools(provider, options);
	const {
		browser_open,
		browser_exec,
		browser_snapshot,
		browser_status,
		browser_close,
		browser_connect,
	} = base.tools;

	server.registerTool(
		browser_open.name,
		{
			description: browser_open.description,
			inputSchema: browser_open.inputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async (input) => textResult(await browser_open.execute(input)),
	);

	server.registerTool(
		browser_exec.name,
		{
			description: browser_exec.description,
			inputSchema: browser_exec.inputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async (input) => textResult(await browser_exec.execute(input)),
	);

	server.registerTool(
		browser_snapshot.name,
		{
			description: browser_snapshot.description,
			inputSchema: browser_snapshot.inputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async (input) => snapshotResult(await browser_snapshot.execute(input)),
	);

	server.registerTool(
		browser_status.name,
		{
			description: browser_status.description,
			inputSchema: browser_status.inputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async (input) => textResult(await browser_status.execute(input)),
	);

	server.registerTool(
		browser_close.name,
		{
			description: browser_close.description,
			inputSchema: browser_close.inputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async (input) => textResult(await browser_close.execute(input)),
	);

	server.registerTool(
		browser_connect.name,
		{
			description: browser_connect.description,
			inputSchema: browser_connect.inputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async (input) => textResult(await browser_connect.execute(input)),
	);

	return { dispose: base.dispose };
}
