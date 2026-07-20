import { createRequire } from "node:module";
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

const require = createRequire(import.meta.url);
const AGENT_BROWSER_SKILL_PATH = resolve(
	dirname(require.resolve("agent-browser/package.json")),
	"skill-data/core",
);

export async function runAgentBrowserHarness(
	task: string,
	workspace: string,
	provider: BrowserProviderName,
): Promise<SessionRun> {
	const browser = await createCloudBrowserConnection(provider);
	try {
		const command = [
			packageCliCommand("agent-browser"),
			"--session",
			shellQuote(browser.sessionName),
			"--cdp",
			shellQuote(browser.cdpEndpoint),
		].join(" ");
		return await runBrowserTask({
			task,
			workspace,
			skillPaths: [AGENT_BROWSER_SKILL_PATH],
			appendSystemPrompt: [
				[
					"A browser connection has already been set up.",
					`Use it by running agent-browser commands with this prefix: ${command}`,
					`Before giving your final answer, close the browser by running: ${command} close`,
				].join(" "),
			],
		});
	} finally {
		await closeCloudBrowserConnection(browser);
	}
}
