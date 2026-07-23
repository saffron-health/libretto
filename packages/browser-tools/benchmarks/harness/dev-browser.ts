import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { SessionRun } from "../agent.js";
import {
	closeCloudBrowserConnection,
	createCloudBrowserConnection,
	packageCliCommand,
	shellQuote,
	type BrowserProviderName,
} from "./cloud-browser.js";
import { runBrowserTask } from "./run-browser-task.js";

const DEV_BROWSER_SKILL_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../skills/dev-browser",
);

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
			skillPaths: [DEV_BROWSER_SKILL_PATH],
			appendSystemPrompt: [
				[
					"A browser connection has already been set up.",
					`Use it by piping JavaScript into: ${command}`,
					"Before giving your final answer, close every page you used with page.close() in a final dev-browser script.",
				].join(" "),
			],
		});
	} finally {
		await closeCloudBrowserConnection(browser);
	}
}
