import { createPiBrowserTools } from "@libretto/browser-tools/pi";
import { KernelBrowserProvider } from "@libretto/browser-tools/kernel";
import {
	DEFAULT_TIMEOUT_MS,
	SessionRunError,
	type SessionRun,
} from "../agent.js";
import { runBrowserTask } from "./run-browser-task.js";

export async function runBrowserToolsHarness(
	task: string,
	workspace: string,
): Promise<SessionRun> {
	const toolkit = createPiBrowserTools(
		new KernelBrowserProvider({
			headless: false,
			stealth: true,
			timeoutSeconds: Math.ceil(DEFAULT_TIMEOUT_MS / 1000),
		}),
	);
	let run: SessionRun;
	try {
		run = await runBrowserTask({
			task,
			workspace,
			customTools: toolkit.tools,
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
