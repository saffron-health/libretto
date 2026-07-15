import type { SnapshotToolOutput } from "../../tools/snapshot.js";
import type { ToolResult } from "../../tool.js";

type SnapshotExecuteResult = ToolResult<SnapshotToolOutput>;

export function snapshotToModelOutput({
	output,
}: {
	toolCallId: string;
	input: unknown;
	output: SnapshotExecuteResult;
}) {
	if (!output.ok) {
		return { type: "error-text" as const, value: output.error };
	}

	if (!output.screenshot) {
		return { type: "text" as const, value: output.tree };
	}

	return {
		type: "content" as const,
		value: [
			{ type: "text" as const, text: output.tree },
			{
				type: "image-data" as const,
				data: output.screenshot.base64,
				mediaType: output.screenshot.mimeType,
			},
		],
	};
}
