#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  getEvalCases,
  withEvalFileRegistration,
  type EvalCaseRecord,
} from "./eval-case.js";
import { createEvalContext } from "./fixtures.js";
import { takeRecordedScores, type EvalScoreRecord } from "./scoring.js";
import {
  takeRecordedEvalCalls,
  type EvalCallRecord,
} from "./run-recorder.js";
import {
  evalAuthProfilePath,
  hasEvalAuthProfile,
  loginAuthProfile,
  missingAuthProfileMessage,
  normalizeAuthProfileDomain,
} from "./auth-profiles.js";
import {
  aggregateMetrics,
  setEvalArtifactPaths,
  type EvalMetrics,
} from "./artifacts.js";

type RunCliOptions = {
  command: "run";
  outputDir: string;
  fileFilters: string[];
  testNamePattern: string | null;
  model: string;
};

type ProfilesStatusCliOptions = {
  command: "profiles-status";
};

type ProfilesLoginCliOptions = {
  command: "profiles-login";
  domain: string;
};

type CliOptions =
  | RunCliOptions
  | ProfilesStatusCliOptions
  | ProfilesLoginCliOptions;

type CaseResult = {
  id: string;
  name: string;
  file: string | null;
  status: "completed" | "error" | "skipped";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  score: {
    passed: number;
    total: number;
    percent: number;
  };
  agentMetrics: EvalMetrics;
  judgeMetrics: EvalMetrics;
  artifacts: {
    result: string;
    transcript: string;
    agentEvents: string;
    agentTranscript: string;
    judgeEvents: string;
    judgeTranscript: string;
  };
  calls: EvalCallRecord[];
  scores: EvalScoreRecord[];
  error?: string;
  skipReason?: string;
};

type RunSummary = {
  generatedAt: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  selectedModel: string;
  totals: {
    cases: number;
    completed: number;
    skipped: number;
    errored: number;
    scorePassed: number;
    scoreTotal: number;
    scorePercent: number;
  };
  metrics: {
    agent: EvalMetrics;
    judge: EvalMetrics;
    combined: EvalMetrics;
  };
  cases: Array<{
    id: string;
    name: string;
    status: CaseResult["status"];
    durationMs: number;
    score: CaseResult["score"];
    agentMetrics: EvalMetrics;
    judgeMetrics: EvalMetrics;
    artifacts: CaseResult["artifacts"];
    error?: string;
    skipReason?: string;
  }>;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const evalsRoot = resolve(here);
const repoRoot = resolve(evalsRoot, "..");
const DEFAULT_EVAL_MODEL = "openai/gpt-5.5";

function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function relativeArtifact(outputDir: string, artifactPath: string): string {
  return toPosixPath(relative(outputDir, artifactPath));
}

function formatDuration(durationMs: number | null): string {
  if (durationMs == null) return "-";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatUsd(value: number | null): string {
  return value == null ? "-" : `$${value.toFixed(4)}`;
}

function formatInteger(value: number | null): string {
  return value == null ? "-" : value.toLocaleString("en-US");
}

function scorePercent(passed: number, total: number): number {
  return total > 0 ? Number(((passed / total) * 100).toFixed(2)) : 0;
}

function metricArtifactsForCase(
  outputDir: string,
  id: string,
): CaseResult["artifacts"] {
  const caseDir = join(outputDir, "cases", id);
  return {
    result: relativeArtifact(outputDir, join(caseDir, "result.json")),
    transcript: relativeArtifact(outputDir, join(caseDir, "transcript.jsonl")),
    agentEvents: relativeArtifact(
      outputDir,
      join(caseDir, "agent-events.jsonl"),
    ),
    agentTranscript: relativeArtifact(
      outputDir,
      join(caseDir, "agent-transcript.md"),
    ),
    judgeEvents: relativeArtifact(
      outputDir,
      join(caseDir, "judge-events.jsonl"),
    ),
    judgeTranscript: relativeArtifact(
      outputDir,
      join(caseDir, "judge-transcript.md"),
    ),
  };
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm evals [run] [file-filter ...] [-t <pattern>] [--output <dir>] [--model <provider/model>]",
    "  pnpm evals profiles status",
    "  pnpm evals profiles login <domain>",
    "",
    "Examples:",
    "  pnpm evals",
    "  pnpm evals run -t network --model openai/gpt-5.5",
    "  pnpm evals basic.eval.ts --output temp/eval-run",
    "  pnpm evals profiles status",
    "  pnpm evals profiles login linkedin.com",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  const first = args[0];
  if (first === "--help" || first === "-h") {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (first === "run") {
    args.shift();
  } else if (first === "profiles") {
    args.shift();
    const subcommand = args.shift();
    if (subcommand === "status") {
      if (args.length > 0) {
        throw new Error("profiles status does not accept extra arguments.");
      }
      return { command: "profiles-status" };
    }
    if (subcommand === "login") {
      const domain = args.shift();
      if (!domain || args.length > 0) {
        throw new Error("Usage: pnpm evals profiles login <domain>");
      }
      return {
        command: "profiles-login",
        domain: normalizeAuthProfileDomain(domain),
      };
    }
    throw new Error("Expected profiles subcommand: status or login.");
  }

  let outputDir: string | null = null;
  let testNamePattern: string | null = null;
  let model = DEFAULT_EVAL_MODEL;
  const fileFilters: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--output") {
      const value = args[index + 1];
      if (!value) throw new Error("--output requires a directory.");
      outputDir = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputDir = arg.slice("--output=".length);
      if (!outputDir) throw new Error("--output requires a directory.");
      continue;
    }
    if (arg === "-t" || arg === "--testNamePattern") {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a pattern.`);
      testNamePattern = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--testNamePattern=")) {
      testNamePattern = arg.slice("--testNamePattern=".length);
      continue;
    }
    if (arg === "--model") {
      const value = args[index + 1];
      if (!value) throw new Error("--model requires a provider/model value.");
      model = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--model=")) {
      model = arg.slice("--model=".length);
      if (!model) throw new Error("--model requires a provider/model value.");
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    fileFilters.push(arg);
  }

  return {
    command: "run",
    outputDir: resolve(
      repoRoot,
      outputDir ?? join("evals", "runs", createRunId()),
    ),
    fileFilters,
    testNamePattern,
    model,
  };
}

function createRunId(): string {
  return new Date().toISOString().replaceAll(":", "-").replace(".", "-");
}

function toPosixPath(filePath: string): string {
  return filePath.split(sep).join("/");
}

function matchesFileFilters(filePath: string, filters: string[]): boolean {
  if (filters.length === 0) return true;
  const absolute = toPosixPath(filePath);
  const relativePath = toPosixPath(relative(evalsRoot, filePath));
  return filters.some((filter) => {
    const resolved = isAbsolute(filter) ? filter : resolve(repoRoot, filter);
    const normalizedFilter = toPosixPath(filter);
    return (
      absolute.includes(toPosixPath(resolved)) ||
      relativePath.includes(normalizedFilter) ||
      absolute.includes(normalizedFilter)
    );
  });
}

async function collectEvalFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  const ignoredTopLevelDirs = new Set([
    "node_modules",
    "profiles",
    "runs",
  ]);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const relativePath = toPosixPath(relative(evalsRoot, path));
    if (entry.isDirectory()) {
      const topLevelDir = relativePath.split("/", 1)[0];
      if (ignoredTopLevelDirs.has(topLevelDir)) {
        continue;
      }
      files.push(...(await collectEvalFiles(path)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".eval.ts")) {
      files.push(path);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function discoverEvalFiles(fileFilters: string[]): Promise<string[]> {
  const files = await collectEvalFiles(evalsRoot);
  return files.filter((file) => matchesFileFilters(file, fileFilters));
}

async function importEvalFiles(files: string[]): Promise<EvalCaseRecord[]> {
  for (const file of files) {
    await withEvalFileRegistration(file, async () => {
      await import(pathToFileURL(file).href);
    });
  }
  return getEvalCases();
}

function filterByName(
  cases: EvalCaseRecord[],
  testNamePattern: string | null,
): EvalCaseRecord[] {
  if (!testNamePattern) return cases;
  const pattern = new RegExp(testNamePattern, "i");
  return cases.filter((evalCase) => pattern.test(evalCase.name));
}

function selectCases(
  cases: EvalCaseRecord[],
  testNamePattern: string | null,
): EvalCaseRecord[] {
  const nameFiltered = filterByName(cases, testNamePattern);
  const onlyCases = nameFiltered.filter((evalCase) => evalCase.only);
  return onlyCases.length > 0 ? onlyCases : nameFiltered;
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || createHash("sha256").update(input).digest("hex").slice(0, 12);
}

function caseIds(cases: EvalCaseRecord[]): Map<EvalCaseRecord, string> {
  const counts = new Map<string, number>();
  const ids = new Map<EvalCaseRecord, string>();
  for (const evalCase of cases) {
    const base = slugify(evalCase.name);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    ids.set(evalCase, count === 0 ? base : `${base}-${count + 1}`);
  }
  return ids;
}

function casesByRequiredProfile(
  cases: EvalCaseRecord[],
): Map<string, EvalCaseRecord[]> {
  const byDomain = new Map<string, EvalCaseRecord[]>();
  for (const evalCase of cases) {
    if (!evalCase.authProfile) continue;
    const casesForDomain = byDomain.get(evalCase.authProfile) ?? [];
    casesForDomain.push(evalCase);
    byDomain.set(evalCase.authProfile, casesForDomain);
  }
  return byDomain;
}

function preflightRequiredProfiles(cases: EvalCaseRecord[]): void {
  const missing = Array.from(casesByRequiredProfile(cases).keys()).filter(
    (domain) => !hasEvalAuthProfile(domain),
  );
  if (missing.length === 0) return;

  throw new Error(missing.map(missingAuthProfileMessage).join("\n\n"));
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sensitiveEnvValues(): string[] {
  return Object.entries(process.env)
    .filter(
      ([name, value]) =>
        /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name) &&
        typeof value === "string" &&
        value.length >= 8,
    )
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);
}

function redactString(value: string, secrets: string[]): string {
  return secrets.reduce(
    (text, secret) => text.split(secret).join("[REDACTED]"),
    value,
  );
}

function redactForSummary(
  value: unknown,
  secrets = sensitiveEnvValues(),
): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) {
    return value.map((item) => redactForSummary(item, secrets));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        redactForSummary(nested, secrets),
      ]),
    );
  }
  return value;
}

async function writeRedactedJson(path: string, value: unknown): Promise<void> {
  await writeJson(path, redactForSummary(value));
}

function buildSummaryMarkdown(summary: RunSummary): string {
  const score = `${summary.totals.scorePassed}/${summary.totals.scoreTotal}`;
  const lines = [
    "# Eval Summary",
    "",
    `- Run ID: \`${summary.runId}\``,
    `- Model: \`${summary.selectedModel}\``,
    `- Duration: \`${formatDuration(summary.durationMs)}\``,
    `- Cases completed: \`${summary.totals.completed}\``,
    `- Cases errored: \`${summary.totals.errored}\``,
    `- Cases skipped: \`${summary.totals.skipped}\``,
    `- Score: \`${score}\` criteria (\`${summary.totals.scorePercent}%\`)`,
    "",
    "Scoring is informational. Low scores do not fail the eval command; setup or runtime errors do.",
    "",
    "## Metrics",
    "",
    `- Total cost: \`${formatUsd(summary.metrics.combined.totalCostUsd)}\``,
    `- Total tokens: \`${formatInteger(summary.metrics.combined.totalTokens)}\``,
    `- Input tokens: \`${formatInteger(summary.metrics.combined.inputTokens)}\``,
    `- Output tokens: \`${formatInteger(summary.metrics.combined.outputTokens)}\``,
    `- Cache read tokens: \`${formatInteger(summary.metrics.combined.cacheReadTokens)}\``,
    `- Cache write tokens: \`${formatInteger(summary.metrics.combined.cacheWriteTokens)}\``,
    `- Tool calls: \`${summary.metrics.combined.totalToolCalls}\``,
    "",
    "## Cases",
    "",
    "| Case | Status | Score | Duration | Cost | Tokens | Tool calls | Artifacts |",
    "|---|---|---:|---:|---:|---:|---:|---|",
  ];

  for (const result of summary.cases) {
    const caseScore = `${result.score.passed}/${result.score.total}`;
    lines.push(
      `| \`${result.name}\` | ${result.status} | \`${caseScore}\` | \`${formatDuration(result.durationMs)}\` | \`${formatUsd(result.agentMetrics.totalCostUsd)}\` | \`${formatInteger(result.agentMetrics.totalTokens)}\` | \`${result.agentMetrics.totalToolCalls}\` | \`${result.artifacts.result}\` |`,
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function runCase(
  evalCase: EvalCaseRecord,
  id: string,
  outputDir: string,
  model: string,
): Promise<CaseResult> {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const caseDir = join(outputDir, "cases", id);
  const artifacts = metricArtifactsForCase(outputDir, id);
  await rm(caseDir, { recursive: true, force: true });
  await mkdir(caseDir, { recursive: true });
  setEvalArtifactPaths({
    transcript: join(caseDir, "transcript.jsonl"),
    agentEvents: join(caseDir, "agent-events.jsonl"),
    agentTranscript: join(caseDir, "agent-transcript.md"),
    judgeEvents: join(caseDir, "judge-events.jsonl"),
    judgeTranscript: join(caseDir, "judge-transcript.md"),
  });
  takeRecordedScores();
  takeRecordedEvalCalls();

  let status: CaseResult["status"] = "completed";
  let errorMessage: string | undefined;
  let cleanupErrorMessage: string | undefined;
  let context: Awaited<ReturnType<typeof createEvalContext>> | null = null;
  try {
    context = await createEvalContext(evalCase, { model });
    await evalCase.run(context);
  } catch (error) {
    status = "error";
    errorMessage = formatError(error);
  } finally {
    try {
      await context?.dispose();
    } catch (error) {
      status = "error";
      cleanupErrorMessage = `Cleanup failed:\n${formatError(error)}`;
    } finally {
      setEvalArtifactPaths(null);
    }
  }

  const finishedMs = Date.now();
  const scores = takeRecordedScores();
  const calls = takeRecordedEvalCalls();
  const scorePassed = scores.reduce((total, score) => total + score.passed, 0);
  const scoreTotal = scores.reduce((total, score) => total + score.total, 0);
  const agentMetrics = aggregateMetrics(
    calls
      .filter((call) => call.source === "agent")
      .map((call) => call.metrics),
  );
  const judgeMetrics = aggregateMetrics(
    calls
      .filter((call) => call.source === "judge")
      .map((call) => call.metrics),
  );
  const combinedError = [errorMessage, cleanupErrorMessage]
    .filter((message) => message && message.length > 0)
    .join("\n\n");
  const result: CaseResult = {
    id,
    name: evalCase.name,
    file: evalCase.filePath ? relative(repoRoot, evalCase.filePath) : null,
    status,
    startedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: finishedMs - startedMs,
    score: {
      passed: scorePassed,
      total: scoreTotal,
      percent: scorePercent(scorePassed, scoreTotal),
    },
    agentMetrics,
    judgeMetrics,
    artifacts,
    calls,
    scores,
    ...(combinedError ? { error: combinedError } : {}),
  };
  await writeJson(join(caseDir, "result.json"), result);
  return result;
}

async function run(options: CliOptions): Promise<number> {
  if (options.command === "profiles-status") {
    return await profilesStatus();
  }
  if (options.command === "profiles-login") {
    await loginAuthProfile(options.domain);
    return 0;
  }

  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const files = await discoverEvalFiles(options.fileFilters);
  if (files.length === 0) {
    throw new Error("No eval files matched the provided filters.");
  }

  const registeredCases = await importEvalFiles(files);
  const selectedCases = selectCases(registeredCases, options.testNamePattern);
  if (selectedCases.length === 0) {
    throw new Error("No eval cases matched the provided filters.");
  }
  preflightRequiredProfiles(selectedCases);

  await mkdir(options.outputDir, { recursive: true });
  process.stdout.write(`Running ${selectedCases.length} eval case(s)\n`);
  process.stdout.write(`Output: ${options.outputDir}\n`);

  const ids = caseIds(selectedCases);
  const results: CaseResult[] = [];
  for (const evalCase of selectedCases) {
    const id = ids.get(evalCase);
    if (!id) {
      throw new Error(`Failed to allocate result ID for ${evalCase.name}`);
    }
    process.stdout.write(`\n▶ ${evalCase.name}\n`);
    const result = await runCase(evalCase, id, options.outputDir, options.model);
    results.push(result);
    if (result.status === "completed") {
      process.stdout.write(`✓ ${evalCase.name}\n`);
    } else if (result.status === "skipped") {
      process.stdout.write(
        `- ${evalCase.name} skipped: ${result.skipReason ?? "No reason provided."}\n`,
      );
    } else {
      process.stdout.write(
        `✗ ${evalCase.name}\n${result.error ?? "Unknown error"}\n`,
      );
    }
  }

  const completed = results.filter(
    (result) => result.status === "completed",
  ).length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const errored = results.filter((result) => result.status === "error").length;
  const scorePassed = results.reduce(
    (total, result) => total + result.score.passed,
    0,
  );
  const scoreTotal = results.reduce(
    (total, result) => total + result.score.total,
    0,
  );
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedMs;
  const runId = relative(repoRoot, options.outputDir).startsWith("evals/runs/")
    ? toPosixPath(relative(join(repoRoot, "evals", "runs"), options.outputDir))
    : dirname(options.outputDir) === join(repoRoot, "evals", "runs")
      ? options.outputDir.split(sep).at(-1) ?? options.outputDir
      : options.outputDir.split(sep).at(-1) ?? options.outputDir;
  const agentMetrics = aggregateMetrics(
    results.map((result) => result.agentMetrics),
  );
  const judgeMetrics = aggregateMetrics(
    results.map((result) => result.judgeMetrics),
  );
  const combinedMetrics = aggregateMetrics([agentMetrics, judgeMetrics]);
  const summary: RunSummary = {
    generatedAt: finishedAt,
    runId,
    startedAt,
    finishedAt,
    durationMs,
    selectedModel: options.model,
    totals: {
      cases: results.length,
      completed,
      skipped,
      errored,
      scorePassed,
      scoreTotal,
      scorePercent: scorePercent(scorePassed, scoreTotal),
    },
    metrics: {
      agent: agentMetrics,
      judge: judgeMetrics,
      combined: combinedMetrics,
    },
    cases: results.map((result) => ({
      id: result.id,
      name: result.name,
      status: result.status,
      durationMs: result.durationMs,
      score: result.score,
      agentMetrics: result.agentMetrics,
      judgeMetrics: result.judgeMetrics,
      artifacts: result.artifacts,
      ...(result.error ? { error: result.error } : {}),
      ...(result.skipReason ? { skipReason: result.skipReason } : {}),
    })),
  };
  const runRecord = {
    runId,
    command: options.command,
    startedAt,
    finishedAt,
    durationMs,
    gitSha: gitSha(),
    outputDir: options.outputDir,
    fileFilters: options.fileFilters,
    testNamePattern: options.testNamePattern,
    selectedModel: options.model,
    totals: summary.totals,
    metrics: summary.metrics,
    cases: results,
  };

  await writeJson(join(options.outputDir, "run.json"), runRecord);
  await writeRedactedJson(join(options.outputDir, "summary.json"), summary);
  await writeFile(
    join(options.outputDir, "summary.md"),
    redactString(buildSummaryMarkdown(summary), sensitiveEnvValues()),
    "utf8",
  );

  process.stdout.write(
    `\nCompleted ${completed}/${results.length} eval case(s); score ${scorePassed}/${scoreTotal}; ${skipped} skipped; ${errored} error(s).\n`,
  );
  return errored > 0 ? 1 : 0;
}

async function profilesStatus(): Promise<number> {
  const files = await discoverEvalFiles([]);
  if (files.length === 0) {
    throw new Error("No eval files found.");
  }

  const registeredCases = await importEvalFiles(files);
  const byDomain = casesByRequiredProfile(registeredCases);
  if (byDomain.size === 0) {
    process.stdout.write(
      "No auth profiles are required by discovered eval cases.\n",
    );
    return 0;
  }

  process.stdout.write("Eval auth profiles:\n");
  for (const [domain, cases] of Array.from(byDomain.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const profilePath = evalAuthProfilePath(domain);
    const exists = hasEvalAuthProfile(domain);
    process.stdout.write(`\n${domain}\n`);
    process.stdout.write(`  Status: ${exists ? "present" : "missing"}\n`);
    process.stdout.write(`  Profile: ${profilePath}\n`);
    process.stdout.write("  Required by:\n");
    for (const evalCase of cases) {
      const file = evalCase.filePath
        ? relative(repoRoot, evalCase.filePath)
        : "unknown file";
      process.stdout.write(`    - ${evalCase.name} (${file})\n`);
    }
    process.stdout.write(
      `  Create/refresh: pnpm evals profiles login ${domain}\n`,
    );
  }
  return 0;
}

try {
  const options = parseArgs(process.argv.slice(2));
  process.exitCode = await run(options);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
}
