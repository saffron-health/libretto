import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { SessionRun } from "../agent.js";
import { createKernelConnection, closeKernelConnection, shellQuote } from "./kernel.js";
import { runBrowserTask } from "./run-browser-task.js";

const require = createRequire(import.meta.url);
const AGENT_BROWSER_SKILL_PATH = resolve(
	dirname(require.resolve("agent-browser/package.json")),
	"skill-data/core",
);

export async function runAgentBrowserHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	const kernel = await createKernelConnection();
	try {
		const command = [
			"agent-browser",
			"--session",
			shellQuote(kernel.sessionName),
			"--cdp",
			shellQuote(kernel.cdpEndpoint),
		].join(" ");
		return await runBrowserTask({
			task,
			workspace,
			skillPaths: [AGENT_BROWSER_SKILL_PATH],
			appendSystemPrompt: [
				[
					"A connection to a cloud browser has already been set up.",
					`Use it by running agent-browser commands with this prefix: ${command}`,
				].join(" "),
			],
		});
	} finally {
		await closeKernelConnection(kernel);
	}
}
