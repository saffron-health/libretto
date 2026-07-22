import {
	defineTool,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import {
	createBrowserTools,
	type BrowserToolkitOptions,
} from "../../create-browser-tools.js";
import type { BrowserProvider } from "../../provider.js";
import type { BrowserCleanupError } from "../../session-registry.js";
import type { BrowserTool, ToolResult } from "../../tool.js";
import type { SnapshotToolOutput } from "../../tools/snapshot.js";

export type PiBrowserToolkit = {
	tools: ToolDefinition[];
	dispose(): Promise<BrowserCleanupError | null>;
};

type PiToolContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

function textContent(result: unknown): PiToolContent[] {
	return [
		{
			type: "text",
			text: JSON.stringify(result, null, 2),
		},
	];
}

function snapshotContent(
	result: ToolResult<SnapshotToolOutput>,
): PiToolContent[] {
	if (!result.ok || !result.screenshot) return textContent(result);
	const { screenshot, ...textResult } = result;
	return [
		...textContent({
			...textResult,
			screenshot: {
				mimeType: screenshot.mimeType,
				note: "Attached as image content.",
			},
		}),
		{
			type: "image",
			data: screenshot.base64,
			mimeType: screenshot.mimeType,
		},
	];
}

function toPiTool<Input, Output>(
	tool: BrowserTool<Input, Output>,
	toContent: (result: ToolResult<Output>) => PiToolContent[] = textContent,
): ToolDefinition {
	return defineTool({
		name: tool.name,
		label: tool.name,
		description: tool.description,
		promptSnippet: `${tool.name}: ${tool.description}`,
		parameters: z.toJSONSchema(
			tool.inputSchema as z.ZodType<Input>,
		) as ToolDefinition["parameters"],
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const result = await tool.execute(params as Input);
			return {
				content: toContent(result),
				details: result,
			};
		},
	});
}

/**
 * Pi adapter: wraps the framework-agnostic browser tools as Pi custom tools.
 * Pass `tools` to `createAgentSession({ customTools: tools })`.
 */
export function createPiBrowserTools(
	provider: BrowserProvider,
	options: BrowserToolkitOptions = {},
): PiBrowserToolkit {
	const base = createBrowserTools(provider, options);
	return {
		tools: [
			toPiTool(base.tools.browser_open),
			toPiTool(base.tools.browser_exec),
			toPiTool(base.tools.browser_snapshot, snapshotContent),
			toPiTool(base.tools.browser_status),
			toPiTool(base.tools.browser_close),
			toPiTool(base.tools.browser_connect),
		],
		dispose: base.dispose,
	};
}
