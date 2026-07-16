import type { SessionRun } from "../agent.js";
import {
	closeCloudBrowserConnection,
	createCloudBrowserConnection,
	packageCliCommand,
	shellQuote,
	type BrowserProviderName,
} from "./cloud-browser.js";
import { runBrowserTask } from "./run-browser-task.js";

export async function runPlaywrightCliHarness(
	task: string,
	workspace: string,
	provider: BrowserProviderName,
): Promise<SessionRun> {
	const browser = await createCloudBrowserConnection(provider);
	try {
		const session = shellQuote(browser.sessionName);
		const command = `${packageCliCommand("playwright-cli")} -s=${session}`;
		return await runBrowserTask({
			task,
			workspace,
			appendSystemPrompt: [
				[
					"A browser connection has already been set up.",
					`Use it by first attaching with ${command} attach --cdp=${shellQuote(browser.cdpEndpoint)},`,
					`then running Playwright CLI commands with this prefix: ${command}`,
				].join(" "),
			],
		});
	} finally {
		await closeCloudBrowserConnection(browser);
	}
}
