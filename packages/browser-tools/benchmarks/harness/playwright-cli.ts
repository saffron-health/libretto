import type { SessionRun } from "../agent.js";
import { runBrowserTask, shellQuote } from "./run-browser-task.js";

export async function runPlaywrightCliHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	return await runBrowserTask({
		task,
		workspace,
		buildAppendSystemPrompt: ({ cdpEndpoint, sessionName }) => {
			const session = shellQuote(sessionName);
			const command = `playwright-cli -s=${session}`;
			return [
				`Attach once with: ${command} attach --cdp=${shellQuote(cdpEndpoint)}`,
				`Then use this command prefix: ${command}`,
			].join("\n");
		},
	});
}
