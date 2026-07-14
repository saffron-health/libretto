import {
	defineTool,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import {
	cliResultText,
	runCliCommand,
	runCliHarness,
	type CliCommandResult,
	type CliHarnessTool,
} from "./cli.js";
import type { SessionRun } from "../agent.js";

const PLAYWRIGHT_CLI_COMMANDS = new Set([
	"goto",
	"type",
	"click",
	"dblclick",
	"fill",
	"drag",
	"drop",
	"hover",
	"select",
	"check",
	"uncheck",
	"snapshot",
	"find",
	"eval",
	"run-code",
	"dialog-accept",
	"dialog-dismiss",
	"resize",
	"go-back",
	"go-forward",
	"reload",
	"press",
	"keydown",
	"keyup",
	"mousemove",
	"mousedown",
	"mouseup",
	"mousewheel",
	"screenshot",
	"tab-list",
	"tab-new",
	"tab-close",
	"tab-select",
]);

const PlaywrightCliInput = z.object({
	args: z
		.array(z.string())
		.min(1)
		.refine((args) => PLAYWRIGHT_CLI_COMMANDS.has(args[0]), {
			message: `Command must be one of: ${[...PLAYWRIGHT_CLI_COMMANDS].join(", ")}`,
		})
		.describe(
			"playwright-cli arguments, beginning with a command such as goto, snapshot, find, click, fill, eval, or run-code",
		),
});

export async function runPlaywrightCliHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	return await runCliHarness({
		task,
		workspace,
		systemPrompt: [
			"You are a browser agent using Microsoft Playwright CLI through the playwright_cli tool.",
			"The tool automatically attaches to the benchmark's Kernel browser before your first command.",
			"Use goto <url> to navigate, snapshot to inspect page refs and text, find <text> to locate relevant snapshot content, and click/fill/eval/run-code as needed.",
			"Do not call open, attach, close, detach, or kill-all yourself.",
			"Complete the task on the requested live website and ground the final answer in observed page evidence.",
			"If the intended site shows a CAPTCHA, bot check, or access-denied challenge, wait once for up to 60 seconds in the same page, inspect it again, and report blocked if it remains.",
			"Do not use another site, an API, a cached copy, or prior knowledge as a fallback.",
			"Return a concise final answer after completing the task.",
		].join(" "),
		createTool: ({ cdpEndpoint, sessionName, workspace: toolWorkspace }) =>
			createPlaywrightCliTool({
				cdpEndpoint,
				sessionName,
				workspace: toolWorkspace,
			}),
	});
}

function createPlaywrightCliTool(options: {
	cdpEndpoint: string;
	sessionName: string;
	workspace: string;
}): CliHarnessTool {
	let attached = false;
	const sessionArg = `-s=${options.sessionName}`;

	async function run(args: string[]): Promise<CliCommandResult> {
		return await runCliCommand({
			command: "playwright-cli",
			args: [sessionArg, ...args],
			cwd: options.workspace,
		});
	}

	const tool = defineTool({
		name: "playwright_cli",
		label: "playwright-cli",
		description:
			"Run one Microsoft Playwright CLI command against the connected Kernel browser.",
		parameters: z.toJSONSchema(PlaywrightCliInput) as ToolDefinition["parameters"],
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const input = PlaywrightCliInput.parse(params);
			if (!attached) {
				const attach = await run([
					"attach",
					`--cdp=${options.cdpEndpoint}`,
				]);
				if (attach.exitCode !== 0 || attach.timedOut) {
					return {
						content: [{ type: "text", text: cliResultText(attach) }],
						details: attach,
					};
				}
				attached = true;
			}
			const result = await run(input.args);
			return {
				content: [{ type: "text", text: cliResultText(result) }],
				details: result,
			};
		},
	});
	return {
		tool,
		async dispose() {
			if (!attached) return;
			const result = await run(["detach"]);
			if (result.exitCode !== 0 && !result.stderr.includes("does not exist")) {
				throw new Error(
					`playwright-cli detach exited ${result.exitCode}: ${result.stderr.trim()}`,
				);
			}
		},
	};
}
