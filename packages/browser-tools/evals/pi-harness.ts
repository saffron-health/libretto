import {
	AuthStorage,
	convertToLlm,
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	ModelRegistry,
	serializeConversation,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { createPiBrowserTools } from "../src/adapters/pi/index.js";
import { KernelBrowserProvider } from "../src/providers/kernel.js";
import { requireOpenAiApiKey } from "./setup.js";

const MODEL_PROVIDER = "openai";
const MODEL_ID = "gpt-5.5";

export type PiBrowserRun = {
	answer: string;
	sessionPath: string;
	transcriptPath: string;
	toolNames: string[];
};

export type TaskJudgment = {
	completed: boolean;
	reasoning: string;
};

async function createPiSession(args: {
	workspace: string;
	sessionManager: SessionManager;
	systemPrompt: string;
	tools?: string[];
	noTools?: "all" | "builtin";
	customTools: ToolDefinition[];
}): Promise<AgentSession> {
	const agentDir = join(args.workspace, ".pi");
	const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
	authStorage.setRuntimeApiKey(MODEL_PROVIDER, requireOpenAiApiKey());
	const modelRegistry = ModelRegistry.create(authStorage);
	const model = modelRegistry.find(MODEL_PROVIDER, MODEL_ID);
	if (!model) {
		throw new Error(`Unknown Pi model: ${MODEL_PROVIDER}/${MODEL_ID}`);
	}
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: args.workspace,
		agentDir,
		settingsManager,
		noExtensions: true,
		agentsFilesOverride: () => ({ agentsFiles: [] }),
		systemPromptOverride: () => args.systemPrompt,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: args.workspace,
		agentDir,
		model,
		thinkingLevel: "medium",
		authStorage,
		modelRegistry,
		resourceLoader,
		settingsManager,
		sessionManager: args.sessionManager,
		tools: args.tools,
		noTools: args.noTools,
		customTools: args.customTools,
	});
	return session;
}

function lastAssistantText(session: AgentSession): string {
	const messages = convertToLlm(session.messages);
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		const text = message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text.trim())
			.filter(Boolean)
			.join("\n");
		if (text) return text;
	}
	throw new Error("Pi browser agent returned no final answer.");
}

export async function runPiBrowserTask(args: {
	task: string;
	workspace: string;
}): Promise<PiBrowserRun> {
	const toolkit = createPiBrowserTools(
		new KernelBrowserProvider({ stealth: true, headless: false }),
	);
	const customTools = toolkit.tools;
	const session = await createPiSession({
		workspace: args.workspace,
		sessionManager: SessionManager.create(args.workspace, args.workspace),
		systemPrompt:
			"You are a browser agent. Complete the user's task on the requested website using the browser tools, then report a concise answer grounded in the page evidence.",
		noTools: "builtin",
		customTools,
	});
	const toolNames: string[] = [];
	const unsubscribe = session.subscribe((event) => {
		if (event.type !== "tool_execution_start") return;
		toolNames.push(event.toolName);
	});

	try {
		await session.prompt(args.task);
		const sessionPath = session.sessionFile;
		if (!sessionPath) {
			throw new Error("Pi browser agent did not persist its session.");
		}
		const transcriptPath = join(args.workspace, "transcript.md");
		await writeFile(
			transcriptPath,
			serializeConversation(convertToLlm(session.messages)),
			"utf8",
		);
		return {
			answer: lastAssistantText(session),
			sessionPath,
			transcriptPath,
			toolNames,
		};
	} finally {
		unsubscribe();
		session.dispose();
		await toolkit.dispose();
	}
}

export async function judgePiBrowserTask(args: {
	task: string;
	run: PiBrowserRun;
	workspace: string;
}): Promise<TaskJudgment> {
	let judgment: TaskJudgment | undefined;
	const reportTool = defineTool({
		name: "report_evaluation",
		label: "Report evaluation",
		description:
			"Report whether the browser agent completed the requested task correctly.",
		parameters: Type.Object({
			completed: Type.Boolean(),
			reasoning: Type.String({ minLength: 1 }),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			judgment = params;
			return {
				content: [{ type: "text", text: "Evaluation recorded." }],
				details: params,
			};
		},
	});
	const session = await createPiSession({
		workspace: args.workspace,
		sessionManager: SessionManager.create(
			args.workspace,
			join(args.workspace, "judge"),
		),
		systemPrompt:
			"You judge browser-agent runs from transcript files. Before reporting, use bash with jq to inspect the persisted JSONL session. Evaluate only whether the requested task was completed correctly according to that evidence. Use report_evaluation for your yes/no decision and concise reasoning. You may call it again to revise your evaluation.",
		tools: ["read", "bash", reportTool.name],
		customTools: [reportTool],
	});

	try {
		await session.prompt(
			[
				`Evaluate the browser-agent run for this task:\n${args.task}`,
				`The persisted Pi session JSONL is ${args.run.sessionPath}.`,
				`A readable transcript is ${args.run.transcriptPath}.`,
				"First use bash with jq to inspect the JSONL's user messages, assistant messages, tool calls, and tool results. Use read for the readable transcript when useful.",
				"Call report_evaluation with whether the task was completed correctly and why. You may update the evaluation by calling the tool again.",
			].join("\n\n"),
		);
		if (!judgment) {
			throw new Error("Pi judge did not call report_evaluation.");
		}
		return judgment;
	} finally {
		session.dispose();
	}
}
