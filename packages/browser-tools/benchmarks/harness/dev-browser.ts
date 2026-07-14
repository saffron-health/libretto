import type { SessionRun } from "../agent.js";
import { closeKernelConnection, createKernelConnection, shellQuote } from "./kernel.js";
import { runBrowserTask } from "./run-browser-task.js";

export async function runDevBrowserHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	const kernel = await createKernelConnection();
	try {
		const command = [
			"dev-browser",
			"--browser",
			shellQuote(kernel.sessionName),
			"--connect",
			shellQuote(kernel.cdpEndpoint),
			"--timeout",
			"110",
		].join(" ");
		return await runBrowserTask({
			task,
			workspace,
			appendSystemPrompt: [
				[
					"A connection to a cloud browser has already been set up.",
					`Use it by piping JavaScript into: ${command}`,
				].join(" "),
			],
		});
	} finally {
		await closeKernelConnection(kernel);
	}
}
