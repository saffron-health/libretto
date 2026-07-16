import {
	defineTool,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { z } from "zod";
import {
	createPiSession,
	runPrompt,
	SessionRunError,
	type SessionRun,
} from "./agent.js";

const JudgmentSchema = z.object({
	completed: z.boolean(),
	reasoning: z.string().trim().min(1),
});
const JUDGE_SYSTEM_PROMPT = [
	"You judge whether a browser agent completed the user's task.",
	"Use read and bash with jq to inspect artifact files instead of asking for their contents.",
	"Use the Pi session JSONL for structured tool evidence and transcript.md for the final answer.",
	"Mark completed only when the agent provides the requested result and the live website evidence reasonably supports it.",
	"If any issue prevented the agent from providing the requested result, mark incomplete. Accurately reporting a CAPTCHA, access denial, timeout, tool failure, or other blocker is not task completion.",
	"Call report_evaluation exactly once with your decision and concise reasoning.",
].join(" ");

export type Judgment = z.infer<typeof JudgmentSchema>;

export async function judgeBrowserRun(options: {
	task: string;
	transcriptPath: string;
	sessionPath: string;
	workspace: string;
}): Promise<{ judgment: Judgment; run: SessionRun }> {
	let judgment: Judgment | null = null;
	const reportTool = defineTool({
		name: "report_evaluation",
		label: "Report evaluation",
		description: "Report whether the browser agent completed the requested task.",
		parameters: z.toJSONSchema(JudgmentSchema) as ToolDefinition["parameters"],
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			judgment = JudgmentSchema.parse(params);
			return {
				content: [{ type: "text", text: "Evaluation recorded." }],
				details: judgment,
			};
		},
	});
	const session = await createPiSession({
		workspace: options.workspace,
		sessionFile: join(options.workspace, "judge", "session.jsonl"),
		systemPrompt: JUDGE_SYSTEM_PROMPT,
		customTools: [reportTool],
		tools: ["read", "bash", "report_evaluation"],
	});
	const run = await runPrompt(
		session,
		[
			`TASK:\n${options.task}`,
			"",
			"ARTIFACTS:",
			`- transcript.md: ${options.transcriptPath}`,
			`- Pi session JSONL: ${options.sessionPath}`,
		].join("\n"),
	);
	if (!judgment) {
		throw new SessionRunError(
			new Error("Judge did not call report_evaluation."),
			run,
		);
	}
	return { judgment, run };
}
