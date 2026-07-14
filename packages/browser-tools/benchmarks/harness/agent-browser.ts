import {
	defineTool,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import {
	cliResultText,
	runCliCommand,
	runCliHarness,
	type CliHarnessTool,
} from "./cli.js";
import type { SessionRun } from "../agent.js";

const AgentBrowserInput = z.object({
	args: z
		.array(z.string())
		.min(1)
		.describe(
			"agent-browser arguments, beginning with a command such as open, snapshot, click, fill, eval, or wait",
		),
});

export async function runAgentBrowserHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	return await runCliHarness({
		task,
		workspace,
		systemPrompt: [
			"You are a browser agent using agent-browser through the agent_browser tool.",
			"Use open <url> to navigate, snapshot -i for compact interactive refs, snapshot for page text, and click/fill/eval/wait as needed.",
			"Complete the task on the requested live website and ground the final answer in observed page evidence.",
			"If the intended site shows a CAPTCHA, bot check, or access-denied challenge, wait once for up to 60 seconds in the same page, inspect it again, and report blocked if it remains.",
			"Do not use another site, an API, a cached copy, or prior knowledge as a fallback.",
			"Return a concise final answer after completing the task.",
		].join(" "),
		createTool: ({ cdpEndpoint, sessionName, workspace: toolWorkspace }) =>
			createAgentBrowserTool({
				cdpEndpoint,
				sessionName,
				workspace: toolWorkspace,
			}),
	});
}

function createAgentBrowserTool(options: {
	cdpEndpoint: string;
	sessionName: string;
	workspace: string;
}): CliHarnessTool {
	const tool = defineTool({
		name: "agent_browser",
		label: "agent-browser",
		description:
			"Run one agent-browser command against the benchmark's connected Kernel browser.",
		parameters: z.toJSONSchema(AgentBrowserInput) as ToolDefinition["parameters"],
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const input = AgentBrowserInput.parse(params);
			const result = await runCliCommand({
				command: "agent-browser",
				args: [
					"--session",
					options.sessionName,
					"--cdp",
					options.cdpEndpoint,
					...input.args,
				],
				cwd: options.workspace,
			});
			return {
				content: [{ type: "text", text: cliResultText(result) }],
				details: result,
			};
		},
	});
	return {
		tool,
		async dispose() {},
	};
}
