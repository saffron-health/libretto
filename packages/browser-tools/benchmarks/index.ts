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
import { runBrowserToolsHarness } from "./harness/browser-tools.js";
import { judgeBrowserRun, type Judgment } from "./judge.js";

const DEFAULT_CONCURRENCY = 5;
const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "../..");

type CliOptions = {
	casePattern?: string;
	concurrency: number;
	outputDir?: string;
	repeatCount: number;
}

const CliOptionsSchema = z.object({
	casePattern: z.string().optional(),
	concurrency: z.number().int().positive(),
	outputDir: z.string().optional(),
	repeatCount: z.number().int().positive(),
});

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

type AffordanceSchema = Parameters<typeof SimpleCLI.option>[0];

function forAffordance(schema: z.ZodType): AffordanceSchema {
	return schema as unknown as AffordanceSchema;
}

const benchmarkInput = SimpleCLI.input({
	positionals: [],
	named: {
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
			agentRun = await runBrowserToolsHarness(
				options.websiteCase.task,
				caseDir,
			);
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

async function runBenchmarks(options: CliOptions): Promise<void> {
	loadRepoEnv();
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
	const runDir = options.outputDir
		? resolve(options.outputDir)
		: join(packageRoot, "benchmarks", "runs", runId);
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

const app = SimpleCLI.define(
	"browser-tools-benchmarks",
	{
		run: SimpleCLI.command({
			description: "Run the 27-site browser-tools benchmark with Pi and Kernel",
		})
			.input(benchmarkInput)
			.handle(async ({ input }) => {
				await runBenchmarks(CliOptionsSchema.parse(input));
			}),
	},
	{
		appendHelpText:
			"Environment: OPENAI_API_KEY and KERNEL_API_KEY are required.",
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
