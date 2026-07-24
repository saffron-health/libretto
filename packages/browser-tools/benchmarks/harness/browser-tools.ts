import { createPiBrowserTools } from "../../src/adapters/pi/index.js";
import { SessionRunError, type SessionRun } from "../agent.js";
import {
	createBenchmarkBrowserProvider,
	type BrowserProviderName,
} from "./cloud-browser.js";
import { runBrowserTask } from "./run-browser-task.js";

export async function runBrowserToolsHarness(
	task: string,
	workspace: string,
	provider: BrowserProviderName,
): Promise<SessionRun> {
	const toolkit = createPiBrowserTools(createBenchmarkBrowserProvider(provider));
	let run: SessionRun;
	try {
		run = await runBrowserTask({
			task,
			workspace,
			customTools: toolkit.tools,
			appendSystemPrompt: [
				"Use the provided browser tools to complete the task. Before giving your final answer, close every browser session you opened with browser_close.",
			],
		});
	} catch (error) {
		try {
			await toolkit.dispose();
		} catch (cleanupError) {
			const message =
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError);
			process.stderr.write(`Browser cleanup also failed: ${message}\n`);
		}
		throw error;
	}
	try {
		await toolkit.dispose();
	} catch (error) {
		throw new SessionRunError(
			new Error(
				`Browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
			),
			run,
		);
	}
	return run;
}
