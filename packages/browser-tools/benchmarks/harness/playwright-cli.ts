import type { SessionRun } from "../agent.js";
import { closeKernelConnection, createKernelConnection, shellQuote } from "./kernel.js";
import { runBrowserTask } from "./run-browser-task.js";

export async function runPlaywrightCliHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	const kernel = await createKernelConnection();
	try {
		const session = shellQuote(kernel.sessionName);
		const command = `playwright-cli -s=${session}`;
		return await runBrowserTask({
			task,
			workspace,
			appendSystemPrompt: [
				[
					"A connection to a cloud browser has already been set up.",
					`Use it by first attaching with ${command} attach --cdp=${shellQuote(kernel.cdpEndpoint)},`,
					`then running Playwright CLI commands with this prefix: ${command}`,
				].join(" "),
			],
		});
	} finally {
		await closeKernelConnection(kernel);
	}
}
