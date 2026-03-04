import type { Plugin } from "@opencode-ai/plugin";

export const BashExitCode: Plugin = async () => {
	return {
		"tool.execute.after": async (input, output) => {
			if (
				input.tool === "bash" &&
				output.metadata?.exit !== undefined &&
				output.metadata.exit !== null &&
				output.metadata.exit !== 0
			) {
				output.output += `\n\nCommand exited with code: ${output.metadata.exit}`;
			}
		},
	};
};
