import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import {
	browserTaskPrompt,
	createPiSession,
	runPrompt,
	SessionRunError,
	usageMetrics,
} from "../agent.js";
import {
	HarnessRunError,
	harnessRunFromPiSession,
	type HarnessRun,
} from "../harness-run.js";

export async function runBrowserTask(options: {
	task: string;
	workspace: string;
	customTools?: ToolDefinition[];
	skillPaths?: string[];
	appendSystemPrompt?: string[];
}): Promise<HarnessRun> {
	const session = await createPiSession({
		workspace: options.workspace,
		sessionFile: join(options.workspace, "session.jsonl"),
		customTools: options.customTools,
		skillPaths: options.skillPaths,
		appendSystemPrompt: options.appendSystemPrompt,
	});
	try {
		const run = await runPrompt(
			session,
			browserTaskPrompt({ task: options.task }),
		);
		return harnessRunFromPiSession(run, usageMetrics(run));
	} catch (error) {
		if (error instanceof SessionRunError) {
			throw new HarnessRunError(
				error,
				harnessRunFromPiSession(error.run, usageMetrics(error.run)),
			);
		}
		session.dispose();
		throw error;
	}
}
