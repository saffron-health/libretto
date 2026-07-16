import type { SessionRun } from "../agent.js";
import {
	closeCloudBrowserConnection,
	createCloudBrowserConnection,
	packageCliCommand,
	shellQuote,
	type BrowserProviderName,
} from "./cloud-browser.js";
import { runBrowserTask } from "./run-browser-task.js";

export async function runDevBrowserHarness(
	task: string,
	workspace: string,
	provider: BrowserProviderName,
): Promise<SessionRun> {
	const browser = await createCloudBrowserConnection(provider);
	try {
		const command = [
			packageCliCommand("dev-browser"),
			"--browser",
			shellQuote(browser.sessionName),
			"--connect",
			shellQuote(browser.cdpEndpoint),
			"--timeout",
			"110",
		].join(" ");
		return await runBrowserTask({
			task,
			workspace,
			appendSystemPrompt: [
				[
					"A browser connection has already been set up.",
					`Use it by piping JavaScript into: ${command}`,
				].join(" "),
			],
		});
	} finally {
		await closeCloudBrowserConnection(browser);
	}
}
