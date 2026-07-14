import type { SessionRun } from "../agent.js";
import { runBashHarness, shellQuote } from "./cli.js";

export async function runAgentBrowserHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	return await runBashHarness({
		task,
		workspace,
		buildSystemPrompt: ({ cdpEndpoint, sessionName }) => {
			const command = [
				"agent-browser",
				"--session",
				shellQuote(sessionName),
				"--cdp",
				shellQuote(cdpEndpoint),
			].join(" ");
			return [
				"You are a browser agent using the agent-browser CLI through the bash tool.",
				`Use this exact command prefix for every browser command: ${command}`,
				"For example, append `open <url>`, `snapshot -i`, `snapshot`, `click @e1`, `fill @e2 <text>`, `eval <js>`, or `wait <milliseconds>`.",
				"Run `agent-browser --help` with bash if you need the canonical CLI usage guide.",
				"Use bash only to invoke agent-browser; do not use curl, wget, another browser tool, another AI command, or direct network utilities.",
				"Do not close all browser sessions or start agent-browser chat.",
				"Complete the task on the requested live website and ground the final answer in observed page evidence.",
				"If the intended site shows a CAPTCHA, bot check, or access-denied challenge, wait once for up to 60 seconds in the same page, inspect it again, and report blocked if it remains.",
				"Do not use another site, an API, a cached copy, or prior knowledge as a fallback.",
				"Return a concise final answer after completing the task.",
			].join(" ");
		},
	});
}
