import {
	AuthStorage,
	convertToLlm,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	serializeConversation,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type AgentSessionEvent,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

const MODEL_PROVIDER = "openai";
const MODEL_ID = "gpt-5.6-sol";

export const MODEL_SELECTOR = `${MODEL_PROVIDER}/${MODEL_ID}`;
export const DEFAULT_TIMEOUT_MS = 10 * 60_000;

export type UsageMetrics = {
	durationMs: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	costUsd: number;
	turns: number;
	toolCalls: Record<string, number>;
	totalToolCalls: number;
}

export type SessionRun = {
	session: AgentSession;
	events: AgentSessionEvent[];
	durationMs: number;
}

export class SessionRunError extends Error {
	readonly run: SessionRun;

	constructor(error: unknown, run: SessionRun) {
		super(error instanceof Error ? error.message : String(error));
		this.name = "SessionRunError";
		this.run = run;
	}
}

export async function createPiSession(options: {
	workspace: string;
	systemPrompt: string;
	customTools: ToolDefinition[];
}): Promise<AgentSession> {
	const apiKey = process.env.OPENAI_API_KEY?.trim();
	if (!apiKey) {
		throw new Error(
			"OPENAI_API_KEY is required to create a benchmark agent session.",
		);
	}
	const agentDir = join(options.workspace, ".pi");
	const authStorage = AuthStorage.create();
	authStorage.setRuntimeApiKey(MODEL_PROVIDER, apiKey);
	const modelRegistry = ModelRegistry.create(authStorage);
	const model = modelRegistry.find(MODEL_PROVIDER, MODEL_ID);
	if (!model) {
		throw new Error(
			`Unknown Pi model ${MODEL_SELECTOR}. Update @earendil-works/pi-coding-agent to a version whose model catalog includes it.`,
		);
	}
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: options.workspace,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		agentsFilesOverride: () => ({ agentsFiles: [] }),
		systemPromptOverride: () => options.systemPrompt,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: options.workspace,
		agentDir,
		model,
		thinkingLevel: "medium",
		authStorage,
		modelRegistry,
		resourceLoader,
		settingsManager,
		sessionManager: SessionManager.inMemory(options.workspace),
		noTools: "builtin",
		customTools: options.customTools,
	});
	return session;
}

export async function runPrompt(
	session: AgentSession,
	prompt: string,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SessionRun> {
	const events: AgentSessionEvent[] = [];
	const unsubscribe = session.subscribe((event) => {
		events.push(event);
		if (event.type === "tool_execution_start") {
			process.stdout.write(`  -> ${event.toolName}\n`);
		}
	});
	const startedMs = Date.now();
	let timeout: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			session.prompt(prompt),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(() => {
					void session.abort().catch(() => {});
					reject(new Error(`Pi run timed out after ${timeoutMs / 1000} seconds.`));
				}, timeoutMs);
			}),
		]);
		return {
			session,
			events,
			durationMs: Date.now() - startedMs,
		};
	} catch (error) {
		throw new SessionRunError(error, {
			session,
			events,
			durationMs: Date.now() - startedMs,
		});
	} finally {
		if (timeout) clearTimeout(timeout);
		unsubscribe();
	}
}

function toolCallCounts(events: AgentSessionEvent[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const event of events) {
		if (event.type !== "tool_execution_start") continue;
		counts[event.toolName] = (counts[event.toolName] ?? 0) + 1;
	}
	return counts;
}

export function usageMetrics(run: SessionRun): UsageMetrics {
	const stats = run.session.getSessionStats();
	const toolCalls = toolCallCounts(run.events);
	return {
		durationMs: run.durationMs,
		inputTokens: stats.tokens.input,
		outputTokens: stats.tokens.output,
		cacheReadTokens: stats.tokens.cacheRead,
		cacheWriteTokens: stats.tokens.cacheWrite,
		totalTokens: stats.tokens.total,
		costUsd: stats.cost,
		turns: stats.assistantMessages,
		toolCalls,
		totalToolCalls: Object.values(toolCalls).reduce(
			(total, count) => total + count,
			0,
		),
	};
}

export function emptyMetrics(): UsageMetrics {
	return {
		durationMs: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		costUsd: 0,
		turns: 0,
		toolCalls: {},
		totalToolCalls: 0,
	};
}

function eventReplacer(key: string, value: unknown): unknown {
	if (typeof value === "bigint") return value.toString();
	if (key === "data" && typeof value === "string" && value.length > 10_000) {
		return `[omitted ${value.length} characters]`;
	}
	return value;
}

export function eventsJsonl(events: AgentSessionEvent[]): string {
	return `${events
		.map((event) => JSON.stringify(event, eventReplacer))
		.join("\n")}\n`;
}

export function transcriptFor(session: AgentSession): string {
	return serializeConversation(convertToLlm(session.messages)).trim();
}
