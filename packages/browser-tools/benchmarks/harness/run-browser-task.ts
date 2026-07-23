import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import {
	browserTaskPrompt,
	createPiSession,
	runPrompt,
	type SessionRun,
} from "../agent.js";

export async function runBrowserTask(options: {
	task: string;
	workspace: string;
	customTools?: ToolDefinition[];
	skillPaths?: string[];
	appendSystemPrompt?: string[];
}): Promise<SessionRun> {
	const session = await createPiSession({
		workspace: options.workspace,
		sessionFile: join(options.workspace, "session.jsonl"),
		customTools: options.customTools,
		skillPaths: options.skillPaths,
		appendSystemPrompt: options.appendSystemPrompt,
	});
	return await runPrompt(session, browserTaskPrompt({ task: options.task }));
}
