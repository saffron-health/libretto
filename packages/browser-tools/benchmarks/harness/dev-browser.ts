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

const DevBrowserInput = z.object({
	script: z
		.string()
		.min(1)
		.describe(
			"JavaScript executed in dev-browser's QuickJS sandbox with browser and console globals",
		),
});

export async function runDevBrowserHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	return await runCliHarness({
		task,
		workspace,
		systemPrompt: [
			"You are a browser agent using dev-browser through the dev_browser tool.",
			"Send JavaScript scripts that use the preconnected browser global.",
			'Use const page = await browser.getPage("main") to get a persistent page, page.goto(...) to navigate, page.snapshotForAI({ track: "main" }) for compact page evidence, and standard Playwright page methods to interact.',
			"Print observations with console.log so they are available in tool results.",
			"Complete the task on the requested live website and ground the final answer in observed page evidence.",
			"If the intended site shows a CAPTCHA, bot check, or access-denied challenge, wait once for up to 60 seconds in the same page, inspect it again, and report blocked if it remains.",
			"Do not use another site, an API, a cached copy, or prior knowledge as a fallback.",
			"Return a concise final answer after completing the task.",
		].join(" "),
		createTool: ({ cdpEndpoint, sessionName, workspace: toolWorkspace }) =>
			createDevBrowserTool({
				cdpEndpoint,
				sessionName,
				workspace: toolWorkspace,
			}),
	});
}

function createDevBrowserTool(options: {
	cdpEndpoint: string;
	sessionName: string;
	workspace: string;
}): CliHarnessTool {
	const tool = defineTool({
		name: "dev_browser",
		label: "dev-browser",
		description:
			"Run one sandboxed dev-browser JavaScript script against the connected Kernel browser.",
		parameters: z.toJSONSchema(DevBrowserInput) as ToolDefinition["parameters"],
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const input = DevBrowserInput.parse(params);
			const result = await runCliCommand({
				command: "dev-browser",
				args: [
					"--browser",
					options.sessionName,
					"--connect",
					options.cdpEndpoint,
					"--timeout",
					"110",
				],
				cwd: options.workspace,
				stdin: input.script,
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
