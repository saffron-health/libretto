import type { SessionRun } from "../agent.js";
import { runBashHarness, shellQuote } from "./cli.js";

export async function runPlaywrightCliHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	return await runBashHarness({
		task,
		workspace,
		buildSystemPrompt: ({ cdpEndpoint, sessionName }) => {
			const session = shellQuote(sessionName);
			const command = `playwright-cli -s=${session}`;
			return [
				"You are a browser agent using Microsoft Playwright CLI through the bash tool.",
				`First attach to the benchmark browser with: ${command} attach --cdp=${shellQuote(cdpEndpoint)}`,
				`Then use this exact command prefix for every browser operation: ${command}`,
				"Use `goto <url>` to navigate, `snapshot` to inspect page refs and text, `find <text>` to locate snapshot content, and `click`, `fill`, `eval`, or `run-code` as needed.",
				"Run `playwright-cli --help` with bash if you need the canonical CLI usage guide.",
				"Use bash only to invoke playwright-cli; do not use curl, wget, another browser tool, or direct network utilities.",
				"Do not open a separate browser or close, detach, or kill browser sessions.",
				"Complete the task on the requested live website and ground the final answer in observed page evidence.",
				"If the intended site shows a CAPTCHA, bot check, or access-denied challenge, wait once for up to 60 seconds in the same page, inspect it again, and report blocked if it remains.",
				"Do not use another site, an API, a cached copy, or prior knowledge as a fallback.",
				"Return a concise final answer after completing the task.",
			].join(" ");
		},
	});
}
