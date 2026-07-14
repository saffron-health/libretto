import type { SessionRun } from "../agent.js";
import { runBrowserTask, shellQuote } from "./run-browser-task.js";

export async function runDevBrowserHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	return await runBrowserTask({
		task,
		workspace,
		buildAppendSystemPrompt: ({ cdpEndpoint, sessionName }) => {
			const command = [
				"dev-browser",
				"--browser",
				shellQuote(sessionName),
				"--connect",
				shellQuote(cdpEndpoint),
				"--timeout",
				"110",
			].join(" ");
			return `Pipe JavaScript into: ${command}`;
		},
	});
}
