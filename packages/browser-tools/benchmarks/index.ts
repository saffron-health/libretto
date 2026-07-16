import { SimpleCLI } from "affordance";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
	emptyMetrics,
	eventsJsonl,
	MODEL_SELECTOR,
	SessionRunError,
	transcriptFor,
	usageMetrics,
	type SessionRun,
	type UsageMetrics,
} from "./agent.js";
import { WEBSITE_CASES, type WebsiteCase } from "./cases.js";
import { runAgentBrowserHarness } from "./harness/agent-browser.js";
import { runBrowserToolsHarness } from "./harness/browser-tools.js";
import {
	BROWSER_PROVIDERS,
	type BrowserProviderName,
} from "./harness/cloud-browser.js";
import { runDevBrowserHarness } from "./harness/dev-browser.js";
import { runPlaywrightCliHarness } from "./harness/playwright-cli.js";
import { judgeBrowserRun, type Judgment } from "./judge.js";

const DEFAULT_CONCURRENCY = 5;
const HARNESS_NAMES = [
	"browser-tools",
	"agent-browser",
	"playwright-cli",
	"dev-browser",
] as const;
type HarnessName = (typeof HARNESS_NAMES)[number];
const HarnessNameSchema = z.enum(HARNESS_NAMES);
const BrowserProviderNameSchema = z.enum(BROWSER_PROVIDERS);
const HARNESS_RUNNERS: Record<
	HarnessName,
	(
		task: string,
		workspace: string,
		provider: BrowserProviderName,
	) => Promise<SessionRun>
> = {
	"browser-tools": runBrowserToolsHarness,
	"agent-browser": runAgentBrowserHarness,
	"playwright-cli": runPlaywrightCliHarness,
	"dev-browser": runDevBrowserHarness,
};
const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "../..");

type CliOptions = {
	caseLimit?: number;
	casePattern?: string;
	concurrency: number;
	harnesses: HarnessName[];
	outputDir?: string;
	provider: BrowserProviderName;
	repeatCount: number;
}

const CliOptionsSchema = z
	.object({
		caseLimit: z.number().int().positive().optional(),
		casePattern: z.string().optional(),
		concurrency: z.number().int().positive(),
		harnesses: z.string().trim().min(1),
		outputDir: z.string().optional(),
		provider: z.string().trim().min(1),
		repeatCount: z.number().int().positive(),
	})
	.transform((input): CliOptions => {
		const harnesses = input.harnesses.split(",").map((name) => {
			const parsed = HarnessNameSchema.safeParse(name.trim());
			if (!parsed.success) {
				throw new Error(
					`Unknown harness "${name}". Valid harnesses: ${HARNESS_NAMES.join(", ")}.`,
				);
			}
			return parsed.data;
		});
		const provider = BrowserProviderNameSchema.safeParse(input.provider);
		if (!provider.success) {
			throw new Error(
				`Unknown provider "${input.provider}". Valid providers: ${BROWSER_PROVIDERS.join(", ")}.`,
			);
		}
		return {
			...input,
			harnesses: [...new Set(harnesses)],
			provider: provider.data,
		};
	});

type AttemptResult = {
	id: string;
	caseName: string;
	harness: HarnessName;
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
		events: string;
		transcript: string;
		session: string;
		result: string;
	};
}

type AffordanceSchema = Parameters<typeof SimpleCLI.option>[0];

function forAffordance(schema: z.ZodType): AffordanceSchema {
	return schema as unknown as AffordanceSchema;
}

const benchmarkInput = SimpleCLI.input({
	positionals: [],
	named: {
		caseLimit: SimpleCLI.option(
			forAffordance(z.coerce.number().int().positive().optional()),
			{
				name: "case-limit",
				help: "Run only the first N matching cases",
			},
		),
		casePattern: SimpleCLI.option(forAffordance(z.string().optional()), {
			name: "case",
			aliases: ["t"],
			help: "Run cases whose names contain this text",
		}),
		concurrency: SimpleCLI.option(
			forAffordance(
				z.coerce.number().int().positive().default(DEFAULT_CONCURRENCY),
			),
			{
				help: `Parallel attempts (default: ${DEFAULT_CONCURRENCY})`,
			},
		),
		harnesses: SimpleCLI.option(
			forAffordance(z.string().default(HARNESS_NAMES.join(","))),
			{
				help: `Comma-separated harnesses (default: ${HARNESS_NAMES.join(",")})`,
			},
		),
		provider: SimpleCLI.option(
			forAffordance(z.string().default("kernel")),
			{
				help: `Browser provider (default: kernel). Valid: ${BROWSER_PROVIDERS.join(", ")}`,
			},
		),
		repeatCount: SimpleCLI.option(
			forAffordance(z.coerce.number().int().positive().default(1)),
			{
				name: "repeat-count",
				help: "Runs per selected case (default: 1)",
			},
		),
		outputDir: SimpleCLI.option(forAffordance(z.string().optional()), {
			name: "output",
			help: "Artifact directory",
		}),
	},
});

function loadRepoEnv(): void {
	const envPath = join(repoRoot, ".env");
	if (!existsSync(envPath)) return;
	process.loadEnvFile(envPath);
}

function requireEnvironment(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(
			`${name} is required. Set it in the environment or ${join(repoRoot, ".env")}, then rerun the benchmark.`,
		);
	}
	return value;
}

function requireProviderEnvironment(provider: BrowserProviderName): void {
	requireEnvironment("OPENAI_API_KEY");
	switch (provider) {
		case "kernel":
			requireEnvironment("KERNEL_API_KEY");
			return;
		case "browserbase":
			requireEnvironment("BROWSERBASE_API_KEY");
			return;
		case "local":
			return;
	}
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

async function writeAgentArtifacts(
	run: SessionRun,
	transcriptPath: string,
	eventsPath: string,
): Promise<void> {
	const transcript = transcriptFor(run.session);
	await writeFile(transcriptPath, `${transcript}\n`, "utf8");
	await writeFile(eventsPath, eventsJsonl(run.events), "utf8");
}

async function runAttempt(options: {
	websiteCase: WebsiteCase;
	harness: HarnessName;
	provider: BrowserProviderName;
	repeat: number;
	runDir: string;
}): Promise<AttemptResult> {
	const id = `${slug(options.websiteCase.name)}-${options.harness}-run-${options.repeat}`;
	const caseDir = join(options.runDir, "cases", id);
	const transcriptPath = join(caseDir, "transcript.md");
	const eventsPath = join(caseDir, "events.jsonl");
	const sessionPath = join(caseDir, "session.jsonl");
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
			agentRun = await HARNESS_RUNNERS[options.harness](
				options.websiteCase.task,
				caseDir,
				options.provider,
			);
		} catch (error) {
			if (error instanceof SessionRunError) agentRun = error.run;
			throw error;
		}
		await writeAgentArtifacts(
			agentRun,
			transcriptPath,
			eventsPath,
		);
		answer = agentRun.session.getLastAssistantText()?.trim() || null;
		if (!answer) throw new Error("Browser agent returned no final answer.");
		try {
			const judged = await judgeBrowserRun({
				task: options.websiteCase.task,
				eventsPath,
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
		harness: options.harness,
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
			events: eventsPath,
			transcript: transcriptPath,
			session: sessionPath,
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

function maxContextTokens(results: AttemptResult[]): number {
	return results.reduce(
		(max, result) => Math.max(max, result.agentMetrics.maxRequestContextTokens),
		0,
	);
}

function summaryMarkdown(options: {
	provider: BrowserProviderName;
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
		"# Browser Harness Benchmark",
		"",
		`- Run: \`${options.runId}\``,
		`- Model: \`${MODEL_SELECTOR}\``,
		`- Browser provider: \`${options.provider}\``,
		`- Started: \`${options.startedAt}\``,
		`- Finished: \`${options.finishedAt}\``,
		`- Attempts: \`${options.results.length}\``,
		`- Completed: \`${completed}\``,
		`- Passed: \`${passed}\``,
		`- Agent duration: \`${(totalMetric(options.results, "durationMs") / 1000).toFixed(1)}s\``,
		`- Maximum request context: \`${maxContextTokens(options.results)}\``,
		`- Agent tokens: \`${totalMetric(options.results, "totalTokens")}\``,
		`- Agent cost: \`$${totalMetric(options.results, "costUsd").toFixed(4)}\``,
		`- Browser tool calls: \`${totalMetric(options.results, "totalToolCalls")}\``,
		"",
		"## Harnesses",
		"",
		"| Harness | Attempts | Completed | Passed | Avg duration | Max context | Tokens | Cost | Tool calls |",
		"|---|---:|---:|---:|---:|---:|---:|---:|---:|",
	];
	for (const harness of HARNESS_NAMES) {
		const harnessResults = options.results.filter(
			(result) => result.harness === harness,
		);
		if (harnessResults.length === 0) continue;
		lines.push(
			`| ${harness} | ${harnessResults.length} | ${harnessResults.filter((result) => result.status === "completed").length} | ${harnessResults.filter((result) => result.judgment?.completed === true).length} | ${(totalMetric(harnessResults, "durationMs") / harnessResults.length / 1000).toFixed(1)}s | ${maxContextTokens(harnessResults)} | ${totalMetric(harnessResults, "totalTokens")} | $${totalMetric(harnessResults, "costUsd").toFixed(4)} | ${totalMetric(harnessResults, "totalToolCalls")} |`,
		);
	}
	lines.push(
		"",
		"## Cases",
		"",
		"| Case | Harness | Repeat | Status | Score | Duration | Max context | Tokens | Cost |",
		"|---|---|---:|---|---|---:|---:|---:|---:|",
	);
	for (const result of options.results) {
		lines.push(
			`| ${result.caseName} | ${result.harness} | ${result.repeat} | ${result.status} | ${result.judgment?.completed === true ? "pass" : "fail"} | ${(result.agentMetrics.durationMs / 1000).toFixed(1)}s | ${result.agentMetrics.maxRequestContextTokens} | ${result.agentMetrics.totalTokens} | $${result.agentMetrics.costUsd.toFixed(4)} |`,
		);
	}
	return `${lines.join("\n")}\n`;
}

async function runBenchmarks(options: CliOptions): Promise<void> {
	loadRepoEnv();
	requireProviderEnvironment(options.provider);

	const matchingCases = options.casePattern
		? WEBSITE_CASES.filter((websiteCase) =>
				websiteCase.name
					.toLowerCase()
					.includes(options.casePattern!.toLowerCase()),
			)
		: WEBSITE_CASES;
	const selectedCases = options.caseLimit
		? matchingCases.slice(0, options.caseLimit)
		: matchingCases;
	if (selectedCases.length === 0) {
		throw new Error(`No benchmark cases matched "${options.casePattern}".`);
	}
	const runId = createRunId();
	const runDir = options.outputDir
		? resolve(options.outputDir)
		: join(packageRoot, "benchmarks", "runs", runId);
	await mkdir(runDir, { recursive: true });
	const attempts = Array.from(
		{ length: options.repeatCount },
		(_unused, repeatIndex) =>
			selectedCases.flatMap((websiteCase) =>
				options.harnesses.map((harness) => ({
					websiteCase,
					harness,
					repeat: repeatIndex + 1,
				})),
			),
	).flat();
	const startedAt = new Date().toISOString();
	await writeFile(
		join(runDir, "run.json"),
		`${JSON.stringify(
			{
				runId,
				model: MODEL_SELECTOR,
				harnesses: options.harnesses,
				browserProvider: options.provider,
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
		`Running ${attempts.length} attempt(s) across ${options.harnesses.join(", ")} with ${MODEL_SELECTOR} and ${options.provider} (concurrency ${options.concurrency}).\n`,
	);
	process.stdout.write(`Output: ${runDir}\n`);
	const results = await mapWithConcurrency(
		attempts,
		options.concurrency,
		async (attempt) =>
			await runAttempt({
				...attempt,
				provider: options.provider,
				runDir,
			}),
	);
	const finishedAt = new Date().toISOString();
	const summary = {
		runId,
		model: MODEL_SELECTOR,
		harnesses: options.harnesses,
		browserProvider: options.provider,
		startedAt,
		finishedAt,
		attempts: results.length,
		completed: results.filter((result) => result.status === "completed").length,
		passed: results.filter((result) => result.judgment?.completed === true)
			.length,
		agentDurationMs: totalMetric(results, "durationMs"),
		maxRequestContextTokens: maxContextTokens(results),
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
		summaryMarkdown({
			provider: options.provider,
			runId,
			results,
			startedAt,
			finishedAt,
		}),
		"utf8",
	);
	process.stdout.write(
		`Completed ${summary.completed}/${summary.attempts}; passed ${summary.passed}/${summary.attempts}.\n`,
	);
	process.stdout.write(`Summary: ${join(runDir, "summary.md")}\n`);
}

const app = SimpleCLI.define(
	"browser-tools-benchmarks",
	{
		run: SimpleCLI.command({
			description:
				"Compare browser harnesses on public websites with Pi and a browser provider",
		})
			.input(benchmarkInput)
			.handle(async ({ input }) => {
				await runBenchmarks(CliOptionsSchema.parse(input));
			}),
	},
	{
		appendHelpText: [
			"Environment: OPENAI_API_KEY is always required.",
			"For --provider kernel: KERNEL_API_KEY.",
			"For --provider browserbase: BROWSERBASE_API_KEY.",
		].join(" "),
	},
);

async function main(): Promise<void> {
	try {
		const result = await app.run(process.argv.slice(2));
		if (typeof result === "string") process.stdout.write(`${result}\n`);
	} catch (error) {
		const message =
			error instanceof Error ? error.stack ?? error.message : String(error);
		process.stderr.write(`${message}\n`);
		process.exitCode = 1;
	}
}

await main();
