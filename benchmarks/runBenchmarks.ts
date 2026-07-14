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
	type AgentSessionEvent,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createPiBrowserTools } from "@libretto/browser-tools/pi";
import { KernelBrowserProvider } from "@libretto/browser-tools/kernel";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

const MODEL_PROVIDER = "openai";
const MODEL_ID = "gpt-5.6-sol";
const MODEL_SELECTOR = `${MODEL_PROVIDER}/${MODEL_ID}`;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const repoRoot = resolve(import.meta.dirname, "..");

type WebsiteCase = {
	name: string;
	task: string;
}

const WEBSITE_CASES: WebsiteCase[] = [
	{
		name: "craigslist used bikes search",
		task: "Search Craigslist for used bikes in San Francisco. Tell me the title and price of the first relevant listing.",
	},
	{
		name: "apartments.com austin apartment search",
		task: "Search Apartments.com for apartments in Austin under $2,000. Tell me the first listing name, price, and neighborhood.",
	},
	{
		name: "apple newest iphone lookup",
		task: "Find the newest iPhone on Apple.com. Tell me its starting price and available colors.",
	},
	{
		name: "google official playwright docs result",
		task: 'Search Google for "Playwright docs network mocking". Open the official docs result and tell me the page title.',
	},
	{
		name: "youtube playwright tutorial search",
		task: 'Search YouTube for "Playwright tutorial". Tell me the title of the first video result.',
	},
	{
		name: "reddit browser automation thread",
		task: 'Search Reddit for "browser automation". Open one relevant thread and summarize the top comment.',
	},
	{
		name: "amazon wireless mouse search",
		task: 'Search Amazon for "wireless mouse". Tell me the name and price of the first organic result.',
	},
	{
		name: "walmart paper towels search",
		task: 'Search Walmart for "paper towels". Tell me the first product name, price, and whether pickup is available.',
	},
	{
		name: "target coffee maker search",
		task: 'Search Target for "coffee maker". Tell me the first product name, price, and rating.',
	},
	{
		name: "best buy headphones search",
		task: 'Search Best Buy for "noise cancelling headphones". Tell me the first product name and price.',
	},
	{
		name: "airbnb austin next weekend search",
		task: "Search Airbnb for stays in Austin next weekend. Tell me the first listing name and nightly price.",
	},
	{
		name: "booking.com chicago hotel search",
		task: "Search Booking.com for hotels in Chicago next weekend. Tell me the first hotel name, rating, and price.",
	},
	{
		name: "expedia sfo jfk flight search",
		task: "Search Expedia for flights from SFO to JFK next Friday. Tell me the cheapest listed price.",
	},
	{
		name: "doordash nyc pizza search",
		task: "Search DoorDash for pizza near New York City. Tell me the first restaurant name and rating.",
	},
	{
		name: "uber eats sf sushi search",
		task: "Search Uber Eats for sushi near San Francisco. Tell me the first restaurant name and delivery estimate.",
	},
	{
		name: "zillow seattle homes search",
		task: "Search Zillow for homes in Seattle under $800k. Tell me the first listing price and address area.",
	},
	{
		name: "realtor.com denver homes search",
		task: "Search Realtor.com for homes in Denver. Tell me the first listing price and number of bedrooms.",
	},
	{
		name: "yelp brooklyn coffee shops search",
		task: "Search Yelp for coffee shops in Brooklyn. Tell me the first business name, rating, and review count.",
	},
	{
		name: "linkedin public job search",
		task: 'Search LinkedIn for "browser automation engineer". Tell me if public results are visible without signing in.',
	},
	{
		name: "hacker news browser automation search",
		task: 'Search Hacker News for "browser automation". Find one recent thread and tell me its title.',
	},
	{
		name: "github playwright repo stats",
		task: "Open the Playwright GitHub repo. Tell me how many stars it has and what language it mostly uses.",
	},
	{
		name: "npm playwright package lookup",
		task: "Look up the playwright package on npm. Tell me the latest version and weekly downloads.",
	},
	{
		name: "pypi requests package lookup",
		task: "Look up the requests package on PyPI. Tell me the latest version and supported Python versions.",
	},
	{
		name: "mdn array map lookup",
		task: "Find the MDN page for Array.prototype.map(). Tell me what the method returns.",
	},
	{
		name: "wikipedia olympics medal table lookup",
		task: "Open the Wikipedia page for the 2024 Summer Olympics medal table. Tell me the top three countries.",
	},
	{
		name: "books to scrape five star cheapest book",
		task: "Find the cheapest book with a 5-star rating on Books to Scrape. Tell me its title and price.",
	},
	{
		name: "quotes to scrape einstein quote",
		task: "Go through Quotes to Scrape and find the first quote by Albert Einstein. Tell me the quote.",
	},
];

type CliOptions = {
	casePattern: string | null;
	concurrency: number;
	outputDir: string | null;
	repeatCount: number;
}

type UsageMetrics = {
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

type Judgment = {
	completed: boolean;
	reasoning: string;
}

type AttemptResult = {
	id: string;
	caseName: string;
	task: string;
	repeat: number;
	status: "completed" | "error";
	answer: string | null;
	judgment: Judgment | null;
	agentMetrics: UsageMetrics;
	judgeMetrics: UsageMetrics;
	startedAt: string;
	finishedAt: string;
	error: string | null;
	artifacts: {
		transcript: string;
		events: string;
		result: string;
	};
}

type SessionRun = {
	session: AgentSession;
	events: AgentSessionEvent[];
	durationMs: number;
}

class SessionRunError extends Error {
	readonly run: SessionRun;

	constructor(error: unknown, run: SessionRun) {
		super(error instanceof Error ? error.message : String(error));
		this.name = "SessionRunError";
		this.run = run;
	}
}

function printHelp(): void {
	process.stdout.write(
		[
			"Run the 27-site browser-tools benchmark with Pi and Kernel.",
			"",
			"Usage:",
			"  pnpm --dir benchmarks benchmark:browser-tools [options]",
			"",
			"Options:",
			"  -t, --case <text>         Run cases whose names contain text",
			`  --concurrency <number>    Parallel attempts (default: ${DEFAULT_CONCURRENCY})`,
			"  --repeat-count <number>   Runs per selected case (default: 1)",
			"  --output <directory>      Artifact directory",
			"  -h, --help                Show this help",
			"",
			"Environment:",
			"  OPENAI_API_KEY and KERNEL_API_KEY are required.",
			"",
		].join("\n"),
	);
}

function positiveInteger(raw: string | undefined, flag: string): number {
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${flag} requires a positive integer.`);
	}
	return parsed;
}

function parseArgs(args: string[]): CliOptions | null {
	const options: CliOptions = {
		casePattern: null,
		concurrency: DEFAULT_CONCURRENCY,
		outputDir: null,
		repeatCount: 1,
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "-h" || arg === "--help") {
			printHelp();
			return null;
		}
		if (arg === "-t" || arg === "--case") {
			const value = args[index + 1];
			if (!value) throw new Error(`${arg} requires a case-name substring.`);
			options.casePattern = value;
			index += 1;
			continue;
		}
		if (arg === "--concurrency") {
			options.concurrency = positiveInteger(args[index + 1], arg);
			index += 1;
			continue;
		}
		if (arg === "--repeat-count") {
			options.repeatCount = positiveInteger(args[index + 1], arg);
			index += 1;
			continue;
		}
		if (arg === "--output") {
			const value = args[index + 1];
			if (!value) throw new Error("--output requires a directory.");
			options.outputDir = resolve(value);
			index += 1;
			continue;
		}
		throw new Error(
			`Unknown option "${arg}". Run pnpm --dir benchmarks benchmark:browser-tools --help.`,
		);
	}
	return options;
}

function loadRepoEnv(): void {
	const envPath = join(repoRoot, ".env");
	if (!existsSync(envPath)) return;
	process.loadEnvFile(envPath);
}

function requireEnvironment(name: "OPENAI_API_KEY" | "KERNEL_API_KEY"): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(
			`${name} is required. Set it in the environment or ${join(repoRoot, ".env")}, then rerun the benchmark.`,
		);
	}
	return value;
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function createRunId(): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `${timestamp}-${randomBytes(3).toString("hex")}`;
}

function jsonReplacer(key: string, value: unknown): unknown {
	if (typeof value === "bigint") return value.toString();
	if (key === "data" && typeof value === "string" && value.length > 10_000) {
		return `[omitted ${value.length} characters]`;
	}
	return value;
}

function eventsJsonl(events: AgentSessionEvent[]): string {
	return `${events
		.map((event) => JSON.stringify(event, jsonReplacer))
		.join("\n")}\n`;
}

function toolCallCounts(events: AgentSessionEvent[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const event of events) {
		if (event.type !== "tool_execution_start") continue;
		counts[event.toolName] = (counts[event.toolName] ?? 0) + 1;
	}
	return counts;
}

function usageMetrics(run: SessionRun): UsageMetrics {
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

function emptyMetrics(): UsageMetrics {
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

async function createPiSession(options: {
	workspace: string;
	systemPrompt: string;
	customTools: ToolDefinition[];
}): Promise<AgentSession> {
	const agentDir = join(options.workspace, ".pi");
	const authStorage = AuthStorage.create();
	authStorage.setRuntimeApiKey(MODEL_PROVIDER, requireEnvironment("OPENAI_API_KEY"));
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

async function runPrompt(
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

async function runBrowserAgent(
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

const JudgmentSchema = z.object({
	completed: z.boolean(),
	reasoning: z.string().trim().min(1),
});

async function judgeBrowserRun(options: {
	task: string;
	transcript: string;
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
		systemPrompt: [
			"You strictly judge browser-agent transcripts.",
			"Mark completed only when the transcript shows live-page evidence from the intended website and the final answer satisfies the task.",
			"Mark incomplete when evidence is missing, the answer is unsupported, or an anti-bot challenge remained unresolved.",
			"Call report_evaluation exactly once with your decision and concise reasoning.",
		].join(" "),
		customTools: [reportTool],
	});
	const run = await runPrompt(
		session,
		[
			`TASK:\n${options.task}`,
			"",
			`BROWSER AGENT TRANSCRIPT:\n${options.transcript}`,
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

function transcriptFor(session: AgentSession): string {
	return serializeConversation(convertToLlm(session.messages)).trim();
}

async function writeAgentArtifacts(
	run: SessionRun,
	transcriptPath: string,
	eventsPath: string,
): Promise<string> {
	const transcript = transcriptFor(run.session);
	await writeFile(transcriptPath, `${transcript}\n`, "utf8");
	await writeFile(eventsPath, eventsJsonl(run.events), "utf8");
	return transcript;
}

async function runAttempt(options: {
	websiteCase: WebsiteCase;
	repeat: number;
	runDir: string;
}): Promise<AttemptResult> {
	const id = `${slug(options.websiteCase.name)}-run-${options.repeat}`;
	const caseDir = join(options.runDir, "cases", id);
	const transcriptPath = join(caseDir, "transcript.md");
	const eventsPath = join(caseDir, "events.jsonl");
	const resultPath = join(caseDir, "result.json");
	await mkdir(caseDir, { recursive: true });

	const startedAt = new Date().toISOString();
	let agentRun: SessionRun | null = null;
	let judgeRun: SessionRun | null = null;
	let answer: string | null = null;
	let judgment: Judgment | null = null;
	let errorMessage: string | null = null;
	process.stdout.write(`[${id}] starting\n`);

	try {
		try {
			agentRun = await runBrowserAgent(options.websiteCase.task, caseDir);
		} catch (error) {
			if (error instanceof SessionRunError) agentRun = error.run;
			throw error;
		}
		const transcript = await writeAgentArtifacts(
			agentRun,
			transcriptPath,
			eventsPath,
		);
		answer = agentRun.session.getLastAssistantText()?.trim() || null;
		if (!answer) throw new Error("Browser agent returned no final answer.");
		try {
			const judged = await judgeBrowserRun({
				task: options.websiteCase.task,
				transcript,
				workspace: join(caseDir, "judge"),
			});
			judgeRun = judged.run;
			judgment = judged.judgment;
		} catch (error) {
			if (error instanceof SessionRunError) judgeRun = error.run;
			throw error;
		}
	} catch (error) {
		if (
			agentRun &&
			(!existsSync(transcriptPath) || !existsSync(eventsPath))
		) {
			await writeAgentArtifacts(agentRun, transcriptPath, eventsPath);
		}
		errorMessage = error instanceof Error ? error.message : String(error);
	} finally {
		agentRun?.session.dispose();
		judgeRun?.session.dispose();
	}

	const result: AttemptResult = {
		id,
		caseName: options.websiteCase.name,
		task: options.websiteCase.task,
		repeat: options.repeat,
		status: errorMessage ? "error" : "completed",
		answer,
		judgment,
		agentMetrics: agentRun ? usageMetrics(agentRun) : emptyMetrics(),
		judgeMetrics: judgeRun ? usageMetrics(judgeRun) : emptyMetrics(),
		startedAt,
		finishedAt: new Date().toISOString(),
		error: errorMessage,
		artifacts: {
			transcript: transcriptPath,
			events: eventsPath,
			result: resultPath,
		},
	};
	await writeFile(
		resultPath,
		`${JSON.stringify(result, jsonReplacer, 2)}\n`,
		"utf8",
	);
	process.stdout.write(
		`[${id}] ${result.status}${judgment ? ` (${judgment.completed ? "pass" : "fail"})` : ""}\n`,
	);
	return result;
}

async function mapWithConcurrency<Input, Output>(
	values: Input[],
	concurrency: number,
	fn: (value: Input) => Promise<Output>,
): Promise<Output[]> {
	const outputs = new Array<Output>(values.length);
	let nextIndex = 0;
	async function worker(): Promise<void> {
		while (nextIndex < values.length) {
			const index = nextIndex;
			nextIndex += 1;
			outputs[index] = await fn(values[index]);
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(concurrency, values.length) }, worker),
	);
	return outputs;
}

function totalMetric(
	results: AttemptResult[],
	key: "durationMs" | "totalTokens" | "costUsd" | "totalToolCalls",
): number {
	return results.reduce((total, result) => total + result.agentMetrics[key], 0);
}

function summaryMarkdown(options: {
	runId: string;
	results: AttemptResult[];
	startedAt: string;
	finishedAt: string;
}): string {
	const completed = options.results.filter(
		(result) => result.status === "completed",
	).length;
	const passed = options.results.filter(
		(result) => result.judgment?.completed === true,
	).length;
	const lines = [
		"# Browser Tools Benchmark",
		"",
		`- Run: \`${options.runId}\``,
		`- Model: \`${MODEL_SELECTOR}\``,
		"- Agent: `browser-tools`",
		"- Browser provider: `kernel`",
		`- Started: \`${options.startedAt}\``,
		`- Finished: \`${options.finishedAt}\``,
		`- Attempts: \`${options.results.length}\``,
		`- Completed: \`${completed}\``,
		`- Passed: \`${passed}\``,
		`- Agent duration: \`${(totalMetric(options.results, "durationMs") / 1000).toFixed(1)}s\``,
		`- Agent tokens: \`${totalMetric(options.results, "totalTokens")}\``,
		`- Agent cost: \`$${totalMetric(options.results, "costUsd").toFixed(4)}\``,
		`- Browser tool calls: \`${totalMetric(options.results, "totalToolCalls")}\``,
		"",
		"| Case | Repeat | Status | Score | Duration | Tokens | Cost |",
		"|---|---:|---|---|---:|---:|---:|",
	];
	for (const result of options.results) {
		lines.push(
			`| ${result.caseName} | ${result.repeat} | ${result.status} | ${result.judgment?.completed === true ? "pass" : "fail"} | ${(result.agentMetrics.durationMs / 1000).toFixed(1)}s | ${result.agentMetrics.totalTokens} | $${result.agentMetrics.costUsd.toFixed(4)} |`,
		);
	}
	return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
	loadRepoEnv();
	const options = parseArgs(process.argv.slice(2));
	if (!options) return;
	requireEnvironment("OPENAI_API_KEY");
	requireEnvironment("KERNEL_API_KEY");

	const selectedCases = options.casePattern
		? WEBSITE_CASES.filter((websiteCase) =>
				websiteCase.name
					.toLowerCase()
					.includes(options.casePattern!.toLowerCase()),
			)
		: WEBSITE_CASES;
	if (selectedCases.length === 0) {
		throw new Error(`No benchmark cases matched "${options.casePattern}".`);
	}
	const runId = createRunId();
	const runDir =
		options.outputDir ?? join(repoRoot, "benchmarks", "runs", runId);
	await mkdir(runDir, { recursive: true });
	const attempts = Array.from(
		{ length: options.repeatCount },
		(_unused, repeatIndex) =>
			selectedCases.map((websiteCase) => ({
				websiteCase,
				repeat: repeatIndex + 1,
			})),
	).flat();
	const startedAt = new Date().toISOString();
	await writeFile(
		join(runDir, "run.json"),
		`${JSON.stringify(
			{
				runId,
				model: MODEL_SELECTOR,
				agent: "browser-tools",
				browserProvider: "kernel",
				concurrency: options.concurrency,
				repeatCount: options.repeatCount,
				cases: selectedCases,
				startedAt,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	process.stdout.write(
		`Running ${attempts.length} browser-tools attempt(s) with ${MODEL_SELECTOR} and Kernel (concurrency ${options.concurrency}).\n`,
	);
	process.stdout.write(`Output: ${runDir}\n`);
	const results = await mapWithConcurrency(
		attempts,
		options.concurrency,
		async (attempt) =>
			await runAttempt({
				...attempt,
				runDir,
			}),
	);
	const finishedAt = new Date().toISOString();
	const summary = {
		runId,
		model: MODEL_SELECTOR,
		agent: "browser-tools",
		browserProvider: "kernel",
		startedAt,
		finishedAt,
		attempts: results.length,
		completed: results.filter((result) => result.status === "completed").length,
		passed: results.filter((result) => result.judgment?.completed === true)
			.length,
		agentDurationMs: totalMetric(results, "durationMs"),
		agentTokens: totalMetric(results, "totalTokens"),
		agentCostUsd: totalMetric(results, "costUsd"),
		agentToolCalls: totalMetric(results, "totalToolCalls"),
		results,
	};
	await writeFile(
		join(runDir, "summary.json"),
		`${JSON.stringify(summary, jsonReplacer, 2)}\n`,
		"utf8",
	);
	await writeFile(
		join(runDir, "summary.md"),
		summaryMarkdown({ runId, results, startedAt, finishedAt }),
		"utf8",
	);
	process.stdout.write(
		`Completed ${summary.completed}/${summary.attempts}; passed ${summary.passed}/${summary.attempts}.\n`,
	);
	process.stdout.write(`Summary: ${join(runDir, "summary.md")}\n`);
}

main().catch((error) => {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});
