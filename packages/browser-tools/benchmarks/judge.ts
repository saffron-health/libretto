import {
	defineTool,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { mkdir } from "node:fs/promises";
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

export type Judgment = z.infer<typeof JudgmentSchema>;

export async function judgeBrowserRun(options: {
	task: string;
	eventsPath: string;
	workspace: string;
}): Promise<{ judgment: Judgment; run: SessionRun }> {
	await mkdir(options.workspace, { recursive: true });
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
		systemPrompt: [
			"You strictly judge browser-agent runs from their raw Pi event stream.",
			"Use bash with jq to inspect only the provided events.jsonl path.",
			"Inspect user messages, completed tool calls and results, and the final assistant answer.",
			"Do not inspect other files, use the network, or treat assistant reasoning as evidence.",
			"Mark completed only when the events show live-page evidence from the intended website and the final answer satisfies the task.",
			"Mark incomplete when evidence is missing, the answer is unsupported, or an anti-bot challenge remained unresolved.",
			"Call report_evaluation exactly once with your decision and concise reasoning.",
		].join(" "),
		tools: ["bash", reportTool.name],
		customTools: [reportTool],
	});
	const run = await runPrompt(
		session,
		[
			`TASK:\n${options.task}`,
			"",
			`EVENTS_JSONL:\n${options.eventsPath}`,
			"",
			"Use jq to inspect the raw events before calling report_evaluation.",
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
