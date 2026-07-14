import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createPiBrowserTools } from "../../src/adapters/pi/index.js";
import { KernelBrowserProvider } from "../../src/providers/kernel.js";
import {
	createPiSession,
	DEFAULT_TIMEOUT_MS,
	runPrompt,
	SessionRunError,
	type SessionRun,
} from "../agent.js";

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
	const session = await createPiSession({
		workspace,
		systemPrompt: [
			"You are a browser agent.",
			"Complete the user's task on the requested live website using only the provided browser tools.",
			"Ground the final answer in evidence observed on that website.",
			"If the intended site shows a CAPTCHA, bot check, or access-denied challenge, wait once for up to 60 seconds in the same page, inspect it again, and report blocked if it remains.",
			"Do not use another site, an API, a cached copy, or prior knowledge as a fallback.",
			"Return a concise final answer after completing the task.",
		].join(" "),
		customTools: toolkit.tools as unknown as ToolDefinition[],
	});

	let run: SessionRun;
	try {
		run = await runPrompt(session, task);
	} catch (error) {
		try {
			await toolkit.dispose();
		} catch (cleanupError) {
			const message =
				cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
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
