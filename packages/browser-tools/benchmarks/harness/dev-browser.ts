import type { SessionRun } from "../agent.js";
import { runBashHarness, shellQuote } from "./cli.js";

export async function runDevBrowserHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	return await runBashHarness({
		task,
		workspace,
		buildSystemPrompt: ({ cdpEndpoint, sessionName }) => {
			const command = [
				"dev-browser",
				"--browser",
				shellQuote(sessionName),
				"--connect",
				shellQuote(cdpEndpoint),
				"--timeout",
				"110",
			].join(" ");
			return [
				"You are a browser agent using the dev-browser CLI through the bash tool.",
				`Pipe JavaScript into this exact command for every browser operation: ${command}`,
				"Run `dev-browser --help` with bash first and follow its canonical LLM usage guide.",
				'Use a stable named page such as `const page = await browser.getPage("main")`, navigate with `page.goto(...)`, inspect with `page.snapshotForAI({ track: "main" })`, interact with standard Playwright page methods, and print evidence with `console.log`.',
				"Use bash only to invoke dev-browser; do not use curl, wget, another browser tool, or direct network utilities.",
				"Complete the task on the requested live website and ground the final answer in observed page evidence.",
				"If the intended site shows a CAPTCHA, bot check, or access-denied challenge, wait once for up to 60 seconds in the same page, inspect it again, and report blocked if it remains.",
				"Do not use another site, an API, a cached copy, or prior knowledge as a fallback.",
				"Return a concise final answer after completing the task.",
			].join(" ");
		},
	});
}
