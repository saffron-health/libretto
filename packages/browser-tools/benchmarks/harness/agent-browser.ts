import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { SessionRun } from "../agent.js";
import { runBrowserTask, shellQuote } from "./run-browser-task.js";

const require = createRequire(import.meta.url);
const AGENT_BROWSER_SKILL_PATH = resolve(
	dirname(require.resolve("agent-browser/package.json")),
	"skill-data/core",
);

export async function runAgentBrowserHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	return await runBrowserTask({
		task,
		workspace,
		skillPaths: [AGENT_BROWSER_SKILL_PATH],
		buildAppendSystemPrompt: ({ cdpEndpoint, sessionName }) => {
			const command = [
				"agent-browser",
				"--session",
				shellQuote(sessionName),
				"--cdp",
				shellQuote(cdpEndpoint),
			].join(" ");
			return `Use this command prefix for agent-browser: ${command}`;
		},
	});
}
