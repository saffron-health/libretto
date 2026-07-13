#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { ExecutionsClient } from "@google-cloud/run";
import {
  getEvalCases,
  withEvalFileRegistration,
  type EvalCaseRecord,
} from "./eval-case.js";
import { createEvalContext } from "./fixtures.js";
import {
  takeRecordedScores,
  withScoreRecording,
  type InfraClassification,
  type EvalScoreRecord,
} from "./scoring.js";
import {
  takeRecordedEvalCalls,
  withEvalCallRecording,
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
  withEvalArtifactPaths,
  type EvalMetrics,
} from "./artifacts.js";
import {
  parseEvalAgentName,
  type EvalAgentName,
} from "./agents.js";
import { dispatchEvalGcpRun } from "./cloud-dispatch.js";
import {
  countCompletedCases,
  createEvalsBucket,
  downloadResults,
  listRunIds,
  readManifest,
  type EvalCloudManifest,
  type EvalCloudTarget,
} from "./cloud-gcs.js";

type RunCliOptions = {
  command: "run";
  outputDir: string;
  fileFilters: string[];
  testNamePattern: string | null;
  model: string;
  provider: BrowserProviderName | null;
  agents: EvalAgentName[];
  concurrency: number | null;
  noAuth: boolean;
  gcp: boolean;
  gcpImage: string | null;
  repeatCount: number;
};

type ProfilesStatusCliOptions = {
  command: "profiles-status";
};

type ProfilesLoginCliOptions = {
  command: "profiles-login";
  domain: string;
};

type SummaryCliOptions = {
  command: "summary";
  runDir: string | null;
  allowEmpty: boolean;
};

type CloudQueryCliOptions = {
  command: "list" | "status" | "results";
  runId: string | null;
};

type CliOptions =
  | RunCliOptions
  | ProfilesStatusCliOptions
  | ProfilesLoginCliOptions
  | SummaryCliOptions
  | CloudQueryCliOptions;

type CaseResult = {
  id: string;
  baseId: string;
  repeatIndex: number;
  repeatCount: number;
  name: string;
  agent: EvalAgentName;
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
  recordingUrls: string[];
  infraClassification: InfraClassification;
  artifacts: {
    result: string;
    transcript: string;
    transcriptMarkdown: string;
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
  repeatCount: number;
  totalCaseDurationMs: number;
  averageCompletedDurationMs: number | null;
  selectedModel: string;
  selectedAgents: EvalAgentName[];
  selectedProvider: BrowserProviderName;
  totals: {
    cases: number;
    attempts: number;
    completed: number;
    skipped: number;
    errored: number;
    scorePassed: number;
    scoreTotal: number;
    scorePercent: number;
  };
  infra: {
    browserSystemErrorCount: number;
    cleanPassCount: number;
    antiBotFailureCount: number;
    systemFailureCount: number;
    ordinaryFailureCount: number;
  };
  metrics: {
    agent: EvalMetrics;
    judge: EvalMetrics;
    combined: EvalMetrics;
  };
  cases: Array<{
    id: string;
    baseId: string;
    repeatIndex: number;
    repeatCount: number;
    name: string;
    agent: EvalAgentName;
    status: CaseResult["status"];
    durationMs: number;
    score: CaseResult["score"];
    agentMetrics: EvalMetrics;
    judgeMetrics: EvalMetrics;
    combinedMetrics: EvalMetrics;
    recordingUrls: string[];
    infraClassification: InfraClassification;
    artifacts: CaseResult["artifacts"];
    error?: string;
    skipReason?: string;
  }>;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const evalsRoot = resolve(here);
const repoRoot = resolve(evalsRoot, "..");
const DEFAULT_EVAL_MODEL = "openai/gpt-5.5";
const DEFAULT_OPENAI_SECRET_NAME = "libretto-test-openai-api-key";
const BROWSER_PROVIDER_NAMES = [
  "local",
  "kernel",
  "browserbase",
  "steel",
  "libretto-cloud",
] as const;
type BrowserProviderName = (typeof BROWSER_PROVIDER_NAMES)[number];

function parseBrowserProviderName(value: string): BrowserProviderName {
  if (BROWSER_PROVIDER_NAMES.includes(value as BrowserProviderName)) {
    return value as BrowserProviderName;
  }
  throw new Error(
    `Invalid provider "${value}". Valid providers: ${BROWSER_PROVIDER_NAMES.join(", ")}`,
  );
}

function selectedProviderName(
  provider: BrowserProviderName | null,
): BrowserProviderName {
  return provider ?? "local";
}

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

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0 && String(parsed) === value) {
    return parsed;
  }
  throw new Error(`${option} must be a positive integer.`);
}

function averageValue(value: number, repeatCount: number): number {
  return value / repeatCount;
}

function averageDuration(value: number, repeatCount: number): number {
  return Math.round(value / repeatCount);
}

function averageOptionalValue(
  value: number | null,
  repeatCount: number,
): number | null {
  return value == null ? null : averageValue(value, repeatCount);
}

function averageNumberMap(
  value: Record<string, number>,
  repeatCount: number,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).map(([key, count]) => [
      key,
      averageValue(count, repeatCount),
    ]),
  );
}

function averageMetrics(metrics: EvalMetrics, repeatCount: number): EvalMetrics {
  if (repeatCount === 1) return metrics;
  return {
    ...metrics,
    durationMs: averageOptionalValue(metrics.durationMs, repeatCount),
    inputTokens: averageOptionalValue(metrics.inputTokens, repeatCount),
    outputTokens: averageOptionalValue(metrics.outputTokens, repeatCount),
    cacheReadTokens: averageOptionalValue(
      metrics.cacheReadTokens,
      repeatCount,
    ),
    cacheWriteTokens: averageOptionalValue(
      metrics.cacheWriteTokens,
      repeatCount,
    ),
    totalTokens: averageOptionalValue(metrics.totalTokens, repeatCount),
    totalCostUsd: averageOptionalValue(metrics.totalCostUsd, repeatCount),
    turns: averageValue(metrics.turns, repeatCount),
    turnsWithUsage: averageValue(metrics.turnsWithUsage, repeatCount),
    toolCalls: averageNumberMap(metrics.toolCalls, repeatCount),
    totalToolCalls: averageValue(metrics.totalToolCalls, repeatCount),
    failedToolCalls: averageValue(metrics.failedToolCalls, repeatCount),
    failedToolCallsByName: averageNumberMap(
      metrics.failedToolCallsByName,
      repeatCount,
    ),
  };
}

function detectedEvalConcurrency(caseCount: number): {
  availableParallelism: number;
  maxParallelCases: number;
} {
  const detectedParallelism = Math.max(1, availableParallelism());
  return {
    availableParallelism: detectedParallelism,
    maxParallelCases: Math.max(1, Math.min(caseCount, detectedParallelism)),
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    }),
  );

  return results;
}

function metricArtifactsForCase(
  outputDir: string,
  id: string,
): CaseResult["artifacts"] {
  const caseDir = join(outputDir, "cases", id);
  return {
    result: relativeArtifact(outputDir, join(caseDir, "result.json")),
    transcript: relativeArtifact(outputDir, join(caseDir, "transcript.jsonl")),
    transcriptMarkdown: relativeArtifact(
      outputDir,
      join(caseDir, "transcript.md"),
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
    "  pnpm evals [run] [file-filter ...] [-t <pattern>] [--output <dir>] [--model <provider/model>] [--provider <browser-provider>] [--agent <agent>] [--agents <agents>] [--concurrency <n>] [--repeat-count <count>] [--no-auth] [--gcp] [--gcp-image <image>]",
    "  pnpm evals summary [run-dir] [--allow-empty]",
    "  pnpm evals list",
    "  pnpm evals status [--run <run-id>]",
    "  pnpm evals results [--run <run-id>]",
    "  pnpm evals profiles status",
    "  pnpm evals profiles login <domain>",
    "",
    "Examples:",
    "  pnpm evals",
    "  pnpm evals --no-auth",
    "  pnpm evals run -t network --model openai/gpt-5.5 --provider kernel",
    "  pnpm evals public-websites.eval.ts --agents libretto,browser-use --concurrency 4",
    "  pnpm evals public-websites.eval.ts --provider kernel --repeat-count 3",
    "  pnpm evals public-websites.eval.ts --agents libretto,browser-use --provider kernel --concurrency 8 --gcp",
    "  pnpm evals public-websites.eval.ts -t quotes --agents libretto,libretto-cached,browser-use --provider steel --concurrency 1 --gcp --gcp-image us-central1-docker.pkg.dev/saffron-health/libretto-benchmarks/evals:2026-05-20-a4fbe7",
    "  pnpm evals status --run 2026-05-20-a1b2c3",
    "  pnpm evals basic.eval.ts --output temp/eval-run",
    "  pnpm evals summary",
    "  pnpm evals summary temp/eval-run",
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
  } else if (first === "summary") {
    args.shift();
    const allowEmptyIndex = args.indexOf("--allow-empty");
    const allowEmpty = allowEmptyIndex >= 0;
    if (allowEmpty) {
      args.splice(allowEmptyIndex, 1);
    }
    if (args.length > 1) {
      throw new Error(
        "Usage: pnpm evals summary [run-dir] [--allow-empty]",
      );
    }
    return {
      command: "summary",
      runDir: args[0] ? resolve(repoRoot, args[0]) : null,
      allowEmpty,
    };
  } else if (first === "list" || first === "status" || first === "results") {
    args.shift();
    if (args[0] === "--help" || args[0] === "-h") {
      process.stdout.write(`${cloudUsage(first)}\n`);
      process.exit(0);
    }
    let runId: string | null = null;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--run") {
        const value = args[index + 1];
        if (!value) throw new Error("--run requires a run ID.");
        runId = value;
        index += 1;
        continue;
      }
      if (arg.startsWith("--run=")) {
        const value = arg.slice("--run=".length);
        if (!value) throw new Error("--run requires a run ID.");
        runId = value;
        continue;
      }
      throw new Error(`Unknown ${first} option: ${arg}`);
    }
    if (first === "list" && runId) {
      throw new Error("list does not accept --run.");
    }
    return {
      command: first,
      runId,
    };
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
  let provider: BrowserProviderName | null = null;
  const agents: EvalAgentName[] = ["libretto"];
  let concurrency: number | null = null;
  let noAuth = false;
  let gcp = false;
  let gcpImage: string | null = null;
  let repeatCount = 1;
  const fileFilters: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--no-auth") {
      noAuth = true;
      continue;
    }
    if (arg === "--gcp") {
      gcp = true;
      continue;
    }
    if (arg === "--gcp-image") {
      const value = args[index + 1];
      if (!value) throw new Error("--gcp-image requires an image tag or digest.");
      gcpImage = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--gcp-image=")) {
      const value = arg.slice("--gcp-image=".length);
      if (!value) throw new Error("--gcp-image requires an image tag or digest.");
      gcpImage = value;
      continue;
    }
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
    if (arg === "--provider") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--provider requires a browser provider value.");
      }
      provider = parseBrowserProviderName(value);
      index += 1;
      continue;
    }
    if (arg === "--agent") {
      const value = args[index + 1];
      if (!value) throw new Error("--agent requires an agent value.");
      agents.splice(0, agents.length, parseEvalAgentName(value));
      index += 1;
      continue;
    }
    if (arg.startsWith("--agent=")) {
      const value = arg.slice("--agent=".length);
      if (!value) throw new Error("--agent requires an agent value.");
      agents.splice(0, agents.length, parseEvalAgentName(value));
      continue;
    }
    if (arg === "--agents") {
      const value = args[index + 1];
      if (!value) throw new Error("--agents requires a comma-separated list.");
      agents.splice(
        0,
        agents.length,
        ...value.split(",").map(parseEvalAgentName),
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--agents=")) {
      const value = arg.slice("--agents=".length);
      if (!value) throw new Error("--agents requires a comma-separated list.");
      agents.splice(
        0,
        agents.length,
        ...value.split(",").map(parseEvalAgentName),
      );
      continue;
    }
    if (arg === "--concurrency") {
      const value = args[index + 1];
      if (!value) throw new Error("--concurrency requires a positive integer.");
      concurrency = Number(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--concurrency=")) {
      const value = arg.slice("--concurrency=".length);
      if (!value) throw new Error("--concurrency requires a positive integer.");
      concurrency = Number(value);
      continue;
    }
    if (arg.startsWith("--provider=")) {
      const value = arg.slice("--provider=".length);
      if (!value) {
        throw new Error("--provider requires a browser provider value.");
      }
      provider = parseBrowserProviderName(value);
      continue;
    }
    if (arg === "--repeat-count") {
      const value = args[index + 1];
      if (!value) throw new Error("--repeat-count requires a count.");
      repeatCount = parsePositiveInteger(value, "--repeat-count");
      index += 1;
      continue;
    }
    if (arg.startsWith("--repeat-count=")) {
      const value = arg.slice("--repeat-count=".length);
      if (!value) throw new Error("--repeat-count requires a count.");
      repeatCount = parsePositiveInteger(value, "--repeat-count");
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    fileFilters.push(arg);
  }

  if (
    concurrency != null &&
    (!Number.isInteger(concurrency) || concurrency <= 0)
  ) {
    throw new Error("--concurrency must be a positive integer.");
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
    provider,
    agents: Array.from(new Set(agents)),
    concurrency,
    noAuth,
    gcp,
    gcpImage,
    repeatCount,
  };
}

function cloudUsage(command: "list" | "status" | "results"): string {
  if (command === "list") {
    return [
      "List GCS-backed eval runs.",
      "",
      "Usage: pnpm evals list",
      "",
      "Example: pnpm evals list",
    ].join("\n");
  }
  return [
    `${command === "status" ? "Show Cloud Run progress for" : "Show aggregated results for"} a GCS-backed eval run.`,
    "",
    `Usage: pnpm evals ${command} [--run <run-id>]`,
    "",
    `Example: pnpm evals ${command} --run 2026-05-20-a1b2c3`,
  ].join("\n");
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
      // oxlint-disable-next-line libretto/no-await-import -- Human-approved: eval files are intentionally discovered and loaded dynamically by the eval CLI.
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
  const normalizedPattern = testNamePattern.toLowerCase();
  return cases.filter((evalCase) =>
    evalCase.name.toLowerCase().includes(normalizedPattern),
  );
}

function selectCases(
  cases: EvalCaseRecord[],
  testNamePattern: string | null,
  noAuth: boolean,
): EvalCaseRecord[] {
  const nameFiltered = filterByName(cases, testNamePattern);
  const authFiltered = noAuth
    ? nameFiltered.filter((evalCase) => !evalCase.authProfile)
    : nameFiltered;
  const onlyCases = authFiltered.filter((evalCase) => evalCase.only);
  return onlyCases.length > 0 ? onlyCases : authFiltered;
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

function caseIdForAgent(baseId: string, agent: EvalAgentName): string {
  return agent === "libretto" ? baseId : `${baseId}-${agent}`;
}

function isCachedAgent(agent: EvalAgentName): boolean {
  return agent === "libretto-cached";
}

function isCloudRunTargetExecution(): boolean {
  return (
    process.env.EVAL_RUN_ID !== undefined &&
    process.env.CLOUD_RUN_TASK_INDEX !== undefined
  );
}

function validateCachedAgentSelection(agents: EvalAgentName[]): void {
  if (
    !isCloudRunTargetExecution() &&
    agents.includes("libretto-cached") &&
    !agents.includes("libretto")
  ) {
    throw new Error(
      [
        "libretto-cached requires libretto in the same run because it replays the workflow generated by the libretto agent.",
        "Rerun with `--agents libretto,libretto-cached`.",
      ].join("\n"),
    );
  }
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

function providerForModel(model: string): string {
  return model.split("/", 1)[0]?.toLowerCase() || "";
}

function ensureOpenAiApiKey(): void {
  if (process.env.OPENAI_API_KEY?.trim()) return;

  const secretName =
    process.env.LIBRETTO_EVAL_OPENAI_SECRET_NAME?.trim() ||
    DEFAULT_OPENAI_SECRET_NAME;

  try {
    const apiKey = execFileSync(
      "gcloud",
      ["secrets", "versions", "access", "latest", `--secret=${secretName}`],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      },
    ).trim();
    if (apiKey) {
      process.env.OPENAI_API_KEY = apiKey;
      process.stdout.write(`Loaded OPENAI_API_KEY from GCP secret ${secretName}.\n`);
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        "Could not load OpenAI eval credentials.",
        "OPENAI_API_KEY is not set, and gcloud access to GCP Secret Manager failed.",
        `Tried GCP Secret Manager secret: ${secretName}`,
        `Set OPENAI_API_KEY, grant gcloud access to ${secretName}, or set LIBRETTO_EVAL_OPENAI_SECRET_NAME to another secret name.`,
        `Original error: ${message}`,
      ].join("\n"),
    );
  }

  throw new Error(
    [
      "OpenAI eval credentials are missing.",
      `GCP Secret Manager secret ${secretName} returned an empty value.`,
      "Set OPENAI_API_KEY or update the secret value.",
    ].join("\n"),
  );
}

function ensureEvalModelCredentials(model: string): void {
  if (providerForModel(model) === "openai") {
    ensureOpenAiApiKey();
  }
}

function missingApiKeyRecommendations(
  message: string,
  model: string | null,
): string | null {
  const provider = message.match(/No API key found for ([^.\s]+)\./)?.[1];
  if (!provider) return null;

  const envVar = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  const selectedModel = model ?? DEFAULT_EVAL_MODEL;
  return [
    "Recommended next actions:",
    `- Evals are running with model \`${selectedModel}\`, which requires credentials for \`${provider}\`.`,
    `- For local runs, set \`${envVar}\` and rerun \`pnpm evals --no-auth\`.`,
    `- For OpenAI evals, you can also authenticate with gcloud and grant access to the \`${DEFAULT_OPENAI_SECRET_NAME}\` Secret Manager secret.`,
    "- To use a different provider, rerun with `pnpm evals --no-auth --model <provider/model>` and configure that provider's credentials.",
    "- In GitHub Actions, add `OPENAI_API_KEY` as a repository secret or authenticate gcloud with access to the eval OpenAI secret.",
  ].join("\n");
}

function formatError(error: unknown, options?: { model?: string }): string {
  const base = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const recommendations = missingApiKeyRecommendations(
    base,
    options?.model ?? null,
  );
  return recommendations ? `${base}\n\n${recommendations}` : base;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Failed to read JSON from ${path}: ${formatError(error)}`);
  }
}

async function recordingUrlsFromTranscript(path: string): Promise<string[]> {
  const urls = new Set<string>();
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
  for (const line of content.split("\n")) {
    if (line.trim().length === 0) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Failed to parse transcript JSON from ${path}: ${formatError(error)}`,
      );
    }
    for (const url of recordingUrlsFromTranscriptRecord(record)) urls.add(url);
  }
  return Array.from(urls);
}

function recordingUrlsFromTranscriptRecord(record: unknown): string[] {
  if (!isRecord(record) || !isRecord(record.event)) return [];

  const urls = new Set<string>();
  addRecordingUrl(urls, recordingUrlField(record.event));
  if (isRecord(record.event.result)) {
    addRecordingUrl(urls, recordingUrlField(record.event.result));
    for (const text of toolResultContentText(record.event.result)) {
      addRecordingUrl(urls, recordingUrlFromCliOutput(text));
    }
  }
  return Array.from(urls);
}

function recordingUrlField(record: Record<string, unknown>): string | null {
  for (const key of ["recordingUrl", "replayUrl", "replayViewUrl", "replay_view_url"]) {
    const value = record[key];
    if (typeof value === "string" && isHttpUrl(value)) return value;
  }
  return null;
}

function toolResultContentText(result: Record<string, unknown>): string[] {
  if (!Array.isArray(result.content)) return [];
  return result.content.flatMap((item) => {
    if (!isRecord(item) || typeof item.text !== "string") return [];
    return [item.text];
  });
}

function recordingUrlFromCliOutput(text: string): string | null {
  for (const line of text.split("\n")) {
    const prefix = "View recording:";
    const trimmed = line.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const url = trimmed.slice(prefix.length).trim();
    return isHttpUrl(url) ? url : null;
  }
  return null;
}

function addRecordingUrl(urls: Set<string>, url: string | null): void {
  if (url) urls.add(url);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value);
}

function classifyInfraResult(
  status: CaseResult["status"],
  score: CaseResult["score"],
  scores: EvalScoreRecord[],
): InfraClassification {
  const passed = status === "completed" && score.total > 0 && score.passed === score.total;
  if (status === "error") return "system-failure";
  const explicitClassification = scores.find(
    (record) => record.infraClassification,
  )?.infraClassification;
  if (explicitClassification) return explicitClassification;
  return passed ? "clean-pass" : "ordinary-failure";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error(`${label} must be an object.`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  throw new Error(`${label} must be a non-empty string.`);
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`${label} must be a finite number.`);
}

function optionalFiniteNumber(value: unknown, label: string): number | null {
  if (value == null) return null;
  return requireFiniteNumber(value, label);
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new Error(`${label} must be a non-negative integer.`);
}

function optionalPositiveInteger(
  value: unknown,
  fallback: number,
  label: string,
): number {
  if (value == null) return fallback;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error(`${label} must be a positive integer.`);
}

function optionalString(value: unknown, label: string): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new Error(`${label} must be a string or null.`);
}

function stringArray(value: unknown, label: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value;
}

function numberMap(value: unknown, label: string): Record<string, number> {
  const record = value == null ? {} : requireRecord(value, label);
  return Object.fromEntries(
    Object.entries(record).map(([key, count]) => [
      key,
      requireNonNegativeInteger(count, `${label}.${key}`),
    ]),
  );
}

function metricsFromResult(value: unknown, label: string): EvalMetrics {
  const metrics = requireRecord(value, label);
  return {
    durationMs: optionalFiniteNumber(metrics.durationMs, `${label}.durationMs`),
    inputTokens: optionalFiniteNumber(metrics.inputTokens, `${label}.inputTokens`),
    outputTokens: optionalFiniteNumber(metrics.outputTokens, `${label}.outputTokens`),
    cacheReadTokens: optionalFiniteNumber(
      metrics.cacheReadTokens,
      `${label}.cacheReadTokens`,
    ),
    cacheWriteTokens: optionalFiniteNumber(
      metrics.cacheWriteTokens,
      `${label}.cacheWriteTokens`,
    ),
    totalTokens: optionalFiniteNumber(metrics.totalTokens, `${label}.totalTokens`),
    totalCostUsd: optionalFiniteNumber(
      metrics.totalCostUsd,
      `${label}.totalCostUsd`,
    ),
    turns: requireNonNegativeInteger(metrics.turns, `${label}.turns`),
    turnsWithUsage: requireNonNegativeInteger(
      metrics.turnsWithUsage,
      `${label}.turnsWithUsage`,
    ),
    toolCalls: numberMap(metrics.toolCalls, `${label}.toolCalls`),
    totalToolCalls: requireNonNegativeInteger(
      metrics.totalToolCalls,
      `${label}.totalToolCalls`,
    ),
    failedToolCalls: requireNonNegativeInteger(
      metrics.failedToolCalls,
      `${label}.failedToolCalls`,
    ),
    failedToolCallsByName: numberMap(
      metrics.failedToolCallsByName,
      `${label}.failedToolCallsByName`,
    ),
    model: optionalString(metrics.model, `${label}.model`),
    provider: optionalString(metrics.provider, `${label}.provider`),
    responseIds: stringArray(metrics.responseIds, `${label}.responseIds`),
    stopReasons: stringArray(metrics.stopReasons, `${label}.stopReasons`),
    sessionId: optionalString(metrics.sessionId, `${label}.sessionId`),
    error: optionalString(metrics.error, `${label}.error`),
    usageTurns: [],
  };
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
    `- Browser provider: \`${summary.selectedProvider}\``,
    `- Repeat count: \`${summary.repeatCount}\``,
    `- Duration: \`${formatDuration(summary.durationMs)}\``,
    `- Total case duration: \`${formatDuration(summary.totalCaseDurationMs)}\``,
    `- Average completed case duration: \`${formatDuration(summary.averageCompletedDurationMs)}\``,
    `- Eval cases: \`${summary.totals.cases}\``,
    `- Attempts: \`${summary.totals.attempts}\``,
    `- Cases completed: \`${summary.totals.completed}\``,
    `- Cases errored: \`${summary.totals.errored}\``,
    `- Cases skipped: \`${summary.totals.skipped}\``,
    `- Score: \`${score}\` criteria (\`${summary.totals.scorePercent}%\`)`,
    `- Browser/system errors: \`${summary.infra.browserSystemErrorCount}\``,
    `- Clean passes: \`${summary.infra.cleanPassCount}\``,
    `- Anti-bot failures: \`${summary.infra.antiBotFailureCount}\``,
    `- System failures: \`${summary.infra.systemFailureCount}\``,
    "",
    "Scoring is informational. Low scores do not fail the eval command; setup or runtime errors do.",
    ...(summary.repeatCount > 1
      ? [
          "Suite-level totals, infra counts, duration, and metrics are averaged per repeat.",
        ]
      : []),
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
    "## Agent Breakdown",
    "",
    "| Agent | Cases | Completed | Score | Agent duration | Agent cost | Agent tokens | Agent tool calls |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];

  const agents = Array.from(new Set(summary.cases.map((result) => result.agent)));
  for (const agent of agents) {
    const cases = summary.cases.filter((result) => result.agent === agent);
    const completed = cases.filter((result) => result.status === "completed");
    const passed = cases.reduce((total, result) => total + result.score.passed, 0);
    const total = cases.reduce((sum, result) => sum + result.score.total, 0);
    const metrics = aggregateMetrics(
      cases.map((result) => result.agentMetrics),
    );
    lines.push(
      `| \`${agent}\` | \`${cases.length}\` | \`${completed.length}\` | \`${passed}/${total}\` | \`${formatDuration(metrics.durationMs)}\` | \`${formatUsd(metrics.totalCostUsd)}\` | \`${formatInteger(metrics.totalTokens)}\` | \`${metrics.totalToolCalls}\` |`,
    );
  }

  lines.push(
    "",
    "## Cases",
    "",
    "| Case | Agent | Attempt | Status | Infra | Score | Duration | Cost | Tokens | Tool calls | Artifacts |",
    "|---|---|---:|---|---|---:|---:|---:|---:|---:|---|",
  );

  for (const result of summary.cases) {
    const caseScore = `${result.score.passed}/${result.score.total}`;
    const attempt = `${result.repeatIndex}/${result.repeatCount}`;
    lines.push(
      `| \`${result.name}\` | \`${result.agent}\` | \`${attempt}\` | ${result.status} | \`${result.infraClassification}\` | \`${caseScore}\` | \`${formatDuration(result.durationMs)}\` | \`${formatUsd(result.combinedMetrics.totalCostUsd)}\` | \`${formatInteger(result.combinedMetrics.totalTokens)}\` | \`${result.combinedMetrics.totalToolCalls}\` | \`${result.artifacts.result}\` |`,
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function runCase(
  evalCase: EvalCaseRecord,
  agent: EvalAgentName,
  id: string,
  baseId: string,
  repeatIndex: number,
  repeatCount: number,
  outputDir: string,
  model: string,
  provider: BrowserProviderName | null,
): Promise<CaseResult> {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const caseDir = join(outputDir, "cases", id);
  const artifacts = metricArtifactsForCase(outputDir, id);
  await rm(caseDir, { recursive: true, force: true });
  await mkdir(caseDir, { recursive: true });
  const artifactPaths = {
    transcript: join(caseDir, "transcript.jsonl"),
    transcriptMarkdown: join(caseDir, "transcript.md"),
    judgeEvents: join(caseDir, "judge-events.jsonl"),
    judgeTranscript: join(caseDir, "judge-transcript.md"),
  };

  let status: CaseResult["status"] = "completed";
  let errorMessage: string | undefined;
  let cleanupErrorMessage: string | undefined;
  let context: Awaited<ReturnType<typeof createEvalContext>> | null = null;
  let scores: EvalScoreRecord[] = [];
  let calls: EvalCallRecord[] = [];

  await withScoreRecording(async () => {
    await withEvalCallRecording(async () => {
      await withEvalArtifactPaths(artifactPaths, async () => {
        takeRecordedScores();
        takeRecordedEvalCalls();

        try {
          context = await createEvalContext(evalCase, {
            agentName: agent,
            model,
            provider,
          });
          await evalCase.run(context);
        } catch (error) {
          status = "error";
          errorMessage = formatError(error, { model });
        } finally {
          try {
            await context?.dispose();
          } catch (error) {
            status = "error";
            cleanupErrorMessage = `Cleanup failed:\n${formatError(error)}`;
          }
        }

        scores = takeRecordedScores();
        calls = takeRecordedEvalCalls();
      });
    });
  });

  const finishedMs = Date.now();
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
  const recordingUrls = await recordingUrlsFromTranscript(artifactPaths.transcript);
  const score = {
    passed: scorePassed,
    total: scoreTotal,
    percent: scorePercent(scorePassed, scoreTotal),
  };
  const result: CaseResult = {
    id,
    baseId,
    repeatIndex,
    repeatCount,
    name: evalCase.name,
    agent,
    file: evalCase.filePath ? relative(repoRoot, evalCase.filePath) : null,
    status,
    startedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: finishedMs - startedMs,
    score,
    agentMetrics,
    judgeMetrics,
    recordingUrls,
    infraClassification: classifyInfraResult(status, score, scores),
    artifacts,
    calls,
    scores,
    ...(combinedError ? { error: combinedError } : {}),
  };
  await writeRedactedJson(join(caseDir, "result.json"), result);
  return result;
}

function caseStatus(value: unknown, label: string): CaseResult["status"] {
  if (value === "completed" || value === "error" || value === "skipped") {
    return value;
  }
  throw new Error(`${label} must be completed, error, or skipped.`);
}

function artifactRecord(value: unknown, label: string): CaseResult["artifacts"] {
  const artifacts = value == null ? {} : requireRecord(value, label);
  const artifactPath = (key: string): string => {
    const path = artifacts[key];
    return typeof path === "string" && path.trim().length > 0 ? path : "-";
  };
  return {
    result: artifactPath("result"),
    transcript: artifactPath("transcript"),
    transcriptMarkdown: artifactPath("transcriptMarkdown"),
    judgeEvents: artifactPath("judgeEvents"),
    judgeTranscript: artifactPath("judgeTranscript"),
  };
}

function infraClassification(
  value: unknown,
  fallback: InfraClassification,
  label: string,
): InfraClassification {
  if (value == null) return fallback;
  if (
    value === "clean-pass" ||
    value === "anti-bot-failure" ||
    value === "system-failure" ||
    value === "ordinary-failure"
  ) {
    return value;
  }
  throw new Error(`${label} must be a valid infra classification.`);
}

function summaryCaseFromResult(
  value: unknown,
  label: string,
): RunSummary["cases"][number] {
  const result = requireRecord(value, label);
  const score = requireRecord(result.score, `${label}.score`);
  const agentMetrics = metricsFromResult(
    result.agentMetrics,
    `${label}.agentMetrics`,
  );
  const judgeMetrics = metricsFromResult(
    result.judgeMetrics,
    `${label}.judgeMetrics`,
  );
  const scoreRecord = {
    passed: requireNonNegativeInteger(score.passed, `${label}.score.passed`),
    total: requireNonNegativeInteger(score.total, `${label}.score.total`),
    percent: requireFiniteNumber(score.percent, `${label}.score.percent`),
  };
  return {
    id: requireString(result.id, `${label}.id`),
    baseId:
      typeof result.baseId === "string" && result.baseId.trim().length > 0
        ? result.baseId
        : requireString(result.id, `${label}.id`),
    repeatIndex: optionalPositiveInteger(
      result.repeatIndex,
      1,
      `${label}.repeatIndex`,
    ),
    repeatCount: optionalPositiveInteger(
      result.repeatCount,
      1,
      `${label}.repeatCount`,
    ),
    name: requireString(result.name, `${label}.name`),
    agent:
      typeof result.agent === "string"
        ? parseEvalAgentName(result.agent)
        : "libretto",
    status: caseStatus(result.status, `${label}.status`),
    durationMs: requireFiniteNumber(result.durationMs, `${label}.durationMs`),
    score: scoreRecord,
    agentMetrics,
    judgeMetrics,
    combinedMetrics: aggregateMetrics([agentMetrics, judgeMetrics]),
    recordingUrls: stringArray(result.recordingUrls, `${label}.recordingUrls`),
    infraClassification: infraClassification(
      result.infraClassification,
      classifyInfraResult(
        caseStatus(result.status, `${label}.status`),
        scoreRecord,
        [],
      ),
      `${label}.infraClassification`,
    ),
    artifacts: artifactRecord(result.artifacts, `${label}.artifacts`),
    ...(typeof result.error === "string" ? { error: result.error } : {}),
    ...(typeof result.skipReason === "string"
      ? { skipReason: result.skipReason }
      : {}),
  };
}

async function loadSummaryCases(
  runDir: string,
): Promise<RunSummary["cases"]> {
  const casesDir = join(runDir, "cases");
  if (!existsSync(casesDir)) return [];

  const entries = await readdir(casesDir, { withFileTypes: true });
  const cases = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const resultPath = join(casesDir, entry.name, "result.json");
        if (!existsSync(resultPath)) return null;
        return summaryCaseFromResult(await readJson(resultPath), resultPath);
      }),
  );
  return cases
    .filter((result): result is RunSummary["cases"][number] => result !== null)
    .sort((a, b) =>
      a.baseId === b.baseId
        ? a.repeatIndex - b.repeatIndex
        : a.baseId.localeCompare(b.baseId),
    );
}

function summarizeInfra(
  cases: Array<{ infraClassification: InfraClassification }>,
  repeatCount = 1,
): RunSummary["infra"] {
  const count = (classification: InfraClassification): number =>
    averageValue(
      cases.filter((result) => result.infraClassification === classification)
        .length,
      repeatCount,
    );
  return {
    browserSystemErrorCount: count("system-failure"),
    cleanPassCount: count("clean-pass"),
    antiBotFailureCount: count("anti-bot-failure"),
    systemFailureCount: count("system-failure"),
    ordinaryFailureCount: count("ordinary-failure"),
  };
}

async function readRunRecord(runDir: string): Promise<Record<string, unknown>> {
  const runPath = join(runDir, "run.json");
  if (!existsSync(runPath)) return {};
  return requireRecord(await readJson(runPath), runPath);
}

async function latestRunDir(): Promise<string> {
  const runsDir = join(evalsRoot, "runs");
  if (!existsSync(runsDir)) {
    throw new Error("No eval runs found. Run pnpm evals first.");
  }

  const entries = await readdir(runsDir, { withFileTypes: true });
  const runDirs = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const path = join(runsDir, entry.name);
          const runRecord = await readRunRecord(path);
          return typeof runRecord.startedAt === "string"
            ? { path, startedAt: runRecord.startedAt }
            : null;
        }),
    )
  ).filter((run): run is { path: string; startedAt: string } => run !== null);
  const latest = runDirs.sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  )[0];
  if (!latest) {
    throw new Error("No eval runs found. Run pnpm evals first.");
  }
  return latest.path;
}

async function runSummary(options: SummaryCliOptions): Promise<number> {
  const runDir = options.runDir ?? (await latestRunDir());
  const cases = await loadSummaryCases(runDir);
  const completed = cases.filter((result) => result.status === "completed");
  if (cases.length === 0 && !options.allowEmpty) {
    throw new Error("Eval summary generation failed: no result records were found.");
  }
  if (completed.length === 0 && !options.allowEmpty) {
    throw new Error(
      "Eval summary generation failed: zero completed eval records were produced.",
    );
  }

  const runRecord = await readRunRecord(runDir);
  const repeatCount = optionalPositiveInteger(
    runRecord.repeatCount,
    cases[0]?.repeatCount ?? 1,
    "run.json.repeatCount",
  );
  const caseCount = new Set(cases.map((result) => result.baseId)).size;
  const scorePassed = averageValue(
    cases.reduce((total, result) => total + result.score.passed, 0),
    repeatCount,
  );
  const scoreTotal = averageValue(
    cases.reduce((total, result) => total + result.score.total, 0),
    repeatCount,
  );
  const agentMetrics = averageMetrics(
    aggregateMetrics(cases.map((result) => result.agentMetrics)),
    repeatCount,
  );
  const judgeMetrics = averageMetrics(
    aggregateMetrics(cases.map((result) => result.judgeMetrics)),
    repeatCount,
  );
  const totalCaseDurationMs = averageDuration(
    cases.reduce((total, result) => total + result.durationMs, 0),
    repeatCount,
  );
  const completedAttempts = completed.length;
  const skippedAttempts = cases.filter(
    (result) => result.status === "skipped",
  ).length;
  const erroredAttempts = cases.filter(
    (result) => result.status === "error",
  ).length;
  const completedAverage = averageValue(completedAttempts, repeatCount);
  const skippedAverage = averageValue(skippedAttempts, repeatCount);
  const erroredAverage = averageValue(erroredAttempts, repeatCount);
  const durationMs =
    typeof runRecord.durationMs === "number" && Number.isFinite(runRecord.durationMs)
      ? runRecord.durationMs
      : typeof runRecord.wallDurationMs === "number" &&
          Number.isFinite(runRecord.wallDurationMs)
        ? averageDuration(runRecord.wallDurationMs, repeatCount)
        : totalCaseDurationMs;
  const averageCompletedDurationMs =
    completedAttempts > 0
      ? Math.round(
          completed.reduce((total, result) => total + result.durationMs, 0) /
            completedAttempts,
        )
      : null;
  const combinedMetrics = aggregateMetrics([agentMetrics, judgeMetrics]);
  const attempts = cases.length;
  const selectedCaseCount = caseCount > 0 ? caseCount : attempts;
  const summary: RunSummary = {
    generatedAt: new Date().toISOString(),
    runId:
      typeof runRecord.runId === "string"
        ? runRecord.runId
        : (runDir.split(sep).at(-1) ?? runDir),
    startedAt:
      typeof runRecord.startedAt === "string" ? runRecord.startedAt : "",
    finishedAt:
      typeof runRecord.finishedAt === "string" ? runRecord.finishedAt : "",
    durationMs,
    repeatCount,
    totalCaseDurationMs,
    averageCompletedDurationMs,
    selectedModel:
      typeof runRecord.selectedModel === "string" ? runRecord.selectedModel : "-",
    selectedAgents: Array.isArray(runRecord.selectedAgents)
      ? runRecord.selectedAgents
          .filter((agent): agent is string => typeof agent === "string")
          .map(parseEvalAgentName)
      : ["libretto"],
    selectedProvider:
      typeof runRecord.selectedProvider === "string"
        ? parseBrowserProviderName(runRecord.selectedProvider)
        : "local",
    totals: {
      cases: selectedCaseCount,
      attempts,
      completed: completedAverage,
      skipped: skippedAverage,
      errored: erroredAverage,
      scorePassed,
      scoreTotal,
      scorePercent: scorePercent(scorePassed, scoreTotal),
    },
    infra: summarizeInfra(cases, repeatCount),
    metrics: {
      agent: agentMetrics,
      judge: judgeMetrics,
      combined: combinedMetrics,
    },
    cases,
  };

  await writeRedactedJson(join(runDir, "summary.json"), summary);
  const markdown = redactString(buildSummaryMarkdown(summary), sensitiveEnvValues());
  await writeFile(join(runDir, "summary.md"), markdown, "utf8");
  process.stdout.write(markdown);
  return 0;
}

type ExecutionProgress = {
  taskCount: number;
  runningCount: number;
  succeededCount: number;
  failedCount: number;
  cancelledCount: number;
  retriedCount: number;
  pendingCount: number;
  status: string;
  logUri: string | null;
};

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const renderRow = (row: string[]): string =>
    row.map((cell, index) => (cell ?? "").padEnd(widths[index]!)).join("  ");
  return [
    renderRow(headers),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(renderRow),
  ].join("\n");
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

function formatShortError(error: string | null | undefined): string {
  if (!error) return "-";
  const oneLine = error.replace(/\s+/g, " ").trim();
  return oneLine.length <= 80 ? oneLine : `${oneLine.slice(0, 77)}...`;
}

function cloudExecutionEntries(
  manifest: EvalCloudManifest,
): Array<{ label: string; executionName: string }> {
  const entries = [
    {
      label: "workflow-generation",
      executionName: manifest.executionNames?.workflowGeneration,
    },
    { label: "independent", executionName: manifest.executionNames?.independent },
    { label: "cached", executionName: manifest.executionNames?.cached },
  ].filter(
    (entry): entry is { label: string; executionName: string } =>
      typeof entry.executionName === "string" && entry.executionName.length > 0,
  );
  if (entries.length > 0) return entries;
  return manifest.executionName
    ? [{ label: "default", executionName: manifest.executionName }]
    : [];
}

function toCount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "bigint") return Number(value);
  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
  ) {
    const parsed = value.toNumber();
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function loadAllCloudManifests(
  bucket: ReturnType<typeof createEvalsBucket>,
): Promise<EvalCloudManifest[]> {
  const runIds = await listRunIds(bucket);
  const manifests = await mapWithConcurrency(runIds, 8, async (runId) => {
    try {
      return await readManifest(bucket, runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `Warning: failed to read eval manifest for ${runId}: ${message}\n`,
      );
      return null;
    }
  });
  return manifests
    .filter((manifest): manifest is EvalCloudManifest => manifest !== null)
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
}

async function resolveCloudManifest(
  bucket: ReturnType<typeof createEvalsBucket>,
  runId: string | null,
): Promise<EvalCloudManifest> {
  if (runId) return await readManifest(bucket, runId);
  const manifests = await loadAllCloudManifests(bucket);
  const latest = manifests[0];
  if (!latest) throw new Error("No GCS-backed eval runs found.");
  return latest;
}

async function readExecutionProgress(
  executionName: string,
): Promise<ExecutionProgress | null> {
  if (!executionName || executionName === "unknown") return null;
  const client = new ExecutionsClient();
  const [execution] = await client.getExecution({ name: executionName });
  const taskCount = toCount(execution.taskCount);
  const runningCount = toCount(execution.runningCount);
  const succeededCount = toCount(execution.succeededCount);
  const failedCount = toCount(execution.failedCount);
  const cancelledCount = toCount(execution.cancelledCount);
  const retriedCount = toCount(execution.retriedCount);
  const pendingCount = Math.max(
    0,
    taskCount - runningCount - succeededCount - failedCount - cancelledCount,
  );
  let status = "unknown";
  if (runningCount > 0) status = "running";
  else if (pendingCount > 0) status = "pending";
  else if (failedCount > 0) status = "failed";
  else if (cancelledCount > 0) status = "cancelled";
  else if (taskCount > 0 && succeededCount >= taskCount) status = "succeeded";
  else if (execution.completionTime) status = "completed";

  return {
    taskCount,
    runningCount,
    succeededCount,
    failedCount,
    cancelledCount,
    retriedCount,
    pendingCount,
    status,
    logUri: execution.logUri ?? null,
  };
}

async function runCloudQuery(options: CloudQueryCliOptions): Promise<number> {
  const bucket = createEvalsBucket();
  if (options.command === "list") {
    const manifests = await loadAllCloudManifests(bucket);
    if (manifests.length === 0) {
      process.stdout.write("No GCS-backed eval runs found.\n");
      return 0;
    }
    const rows = await mapWithConcurrency(manifests, 8, async (manifest) => {
      const summary = await countCompletedCases(bucket, manifest.runId);
      return [
        manifest.runId,
        formatTimestamp(manifest.startedAt),
        manifest.model,
        manifest.browserProvider,
        String(summary.total),
        String(summary.completed),
        String(summary.passed),
        String(summary.errored),
      ];
    });
    process.stdout.write(
      `${renderTable(["RUN ID", "STARTED", "MODEL", "PROVIDER", "TOTAL", "DONE", "PASSED", "ERRORS"], rows)}\n`,
    );
    return 0;
  }

  const manifest = await resolveCloudManifest(bucket, options.runId);
  const summary = await countCompletedCases(bucket, manifest.runId);
  if (options.command === "status") {
    const executionEntries = cloudExecutionEntries(manifest);
    const progressRows = await mapWithConcurrency(
      executionEntries,
      4,
      async ({ label, executionName }) => {
        try {
          const progress = await readExecutionProgress(executionName);
          return { label, executionName, progress, error: null };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(
            `Warning: failed to read Cloud Run execution ${executionName}: ${message}\n`,
          );
          return { label, executionName, progress: null, error: message };
        }
      },
    );

    const lines = [
      `Run: ${manifest.runId}`,
      `Started: ${formatTimestamp(manifest.startedAt)}`,
      `Model: ${manifest.model}`,
      `Browser provider: ${manifest.browserProvider}`,
      `Execution: ${manifest.executionName || "-"}`,
      progressRows.length === 1 && progressRows[0]?.progress?.logUri
        ? `Logs: ${progressRows[0].progress.logUri}`
        : null,
      "",
      "Uploaded results:",
      `  completed: ${summary.completed}/${summary.total}`,
      `  passed: ${summary.passed}`,
      `  failed: ${summary.failed}`,
      `  errored: ${summary.errored}`,
      `  skipped: ${summary.skipped}`,
      progressRows.length > 0 ? "" : "Cloud Run progress unavailable.",
      progressRows.length > 0 ? "Cloud Run:" : null,
      progressRows.length > 0
        ? renderTable(
            [
              "LANE",
              "STATUS",
              "RUNNING",
              "PENDING",
              "SUCCEEDED",
              "FAILED",
              "CANCELLED",
              "RETRIED",
              "EXECUTION",
            ],
            progressRows.map(({ label, executionName, progress, error }) => [
              label,
              progress?.status ?? "unknown",
              progress ? String(progress.runningCount) : "-",
              progress ? String(progress.pendingCount) : "-",
              progress ? String(progress.succeededCount) : "-",
              progress ? String(progress.failedCount) : "-",
              progress ? String(progress.cancelledCount) : "-",
              progress ? String(progress.retriedCount) : "-",
              error ? `${executionName} (${error})` : executionName,
            ]),
          )
        : null,
    ].filter((line): line is string => line !== null);
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  const downloadedResults = await downloadResults(bucket, manifest.runId);
  const resultsByTarget = new Map(
    downloadedResults.map(({ targetId, result }) => [targetId, result]),
  );
  const rows = manifest.targets.map((target) => {
    const result = resultsByTarget.get(target.id);
    return [
      target.name,
      target.agent,
      result?.status ?? "pending",
      result ? `${result.score.passed}/${result.score.total}` : "-",
      result ? formatDuration(result.agentMetrics.durationMs ?? result.durationMs) : "-",
      result?.agentMetrics.totalCostUsd == null
        ? "-"
        : formatUsd(result.agentMetrics.totalCostUsd),
      result?.agentMetrics.totalTokens == null
        ? "-"
        : formatInteger(result.agentMetrics.totalTokens),
      formatShortError(result?.error),
    ];
  });

  process.stdout.write(
    [
      `Run: ${manifest.runId}`,
      `Started: ${formatTimestamp(manifest.startedAt)}`,
      `Completed: ${summary.completed}/${summary.total}`,
      `Passed: ${summary.passed}`,
      `Failed: ${summary.failed}`,
      `Errored: ${summary.errored}`,
      "",
      renderTable(
        ["CASE", "AGENT", "STATUS", "SCORE", "AGENT DURATION", "AGENT COST", "AGENT TOKENS", "ERROR"],
        rows,
      ),
      "",
    ].join("\n"),
  );
  return 0;
}

function cloudTargets(
  selectedCases: EvalCaseRecord[],
  ids: Map<EvalCaseRecord, string>,
  agents: EvalAgentName[],
): EvalCloudTarget[] {
  const targets: EvalCloudTarget[] = [];
  for (const evalCase of selectedCases) {
    const baseId = ids.get(evalCase);
    if (!baseId) throw new Error(`Failed to allocate result ID for ${evalCase.name}`);
    if (!evalCase.filePath) {
      throw new Error(`Eval case ${evalCase.name} is missing file metadata.`);
    }
    for (const agent of agents) {
      targets.push({
        index: targets.length,
        id: caseIdForAgent(baseId, agent),
        baseId,
        name: evalCase.name,
        agent,
        file: toPosixPath(relative(repoRoot, evalCase.filePath)),
      });
    }
  }
  return targets;
}

async function runSelectedCases(
  selectedCases: EvalCaseRecord[],
  ids: Map<EvalCaseRecord, string>,
  options: RunCliOptions,
  repeatIndex: number,
  maxParallelCases: number,
): Promise<CaseResult[]> {
  async function runTargets(
    targets: Array<{ evalCase: EvalCaseRecord; agent: EvalAgentName }>,
  ): Promise<CaseResult[]> {
    const concurrency = options.concurrency ?? maxParallelCases;
    return await mapWithConcurrency(targets, concurrency, async (target) => {
      const { evalCase, agent } = target;
      const baseId = ids.get(evalCase);
      if (!baseId) {
        throw new Error(`Failed to allocate result ID for ${evalCase.name}`);
      }
      const agentId = caseIdForAgent(baseId, agent);
      const id =
        options.repeatCount === 1
          ? agentId
          : `${agentId}-repeat-${repeatIndex}`;
      const repeatLabel =
        options.repeatCount === 1
          ? ""
          : ` (repeat ${repeatIndex}/${options.repeatCount})`;

      process.stdout.write(`\n▶ ${evalCase.name} [${agent}]${repeatLabel}\n`);
      const result = await runCase(
        evalCase,
        agent,
        id,
        baseId,
        repeatIndex,
        options.repeatCount,
        options.outputDir,
        options.model,
        options.provider,
      );
      if (result.status === "completed") {
        process.stdout.write(`✓ ${evalCase.name} [${agent}]${repeatLabel}\n`);
      } else if (result.status === "skipped") {
        process.stdout.write(
          `- ${evalCase.name} [${agent}]${repeatLabel} skipped: ${result.skipReason ?? "No reason provided."}\n`,
        );
      } else {
        process.stdout.write(
          `✗ ${evalCase.name} [${agent}]${repeatLabel}\n${result.error ?? "Unknown error"}\n`,
        );
      }
      return result;
    });
  }

  const allTargets = selectedCases.flatMap((evalCase) =>
    options.agents.map((agent) => ({ evalCase, agent })),
  );
  const primaryTargets = allTargets.filter((target) => !isCachedAgent(target.agent));
  const cachedTargets = allTargets.filter((target) => isCachedAgent(target.agent));

  return [
    ...(await runTargets(primaryTargets)),
    ...(await runTargets(cachedTargets)),
  ];
}

async function run(options: CliOptions): Promise<number> {
  if (options.command === "summary") {
    return await runSummary(options);
  }
  if (
    options.command === "list" ||
    options.command === "status" ||
    options.command === "results"
  ) {
    return await runCloudQuery(options);
  }
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
  const selectedCases = selectCases(
    registeredCases,
    options.testNamePattern,
    options.noAuth,
  );
  if (selectedCases.length === 0) {
    throw new Error(
      options.noAuth
        ? "No eval cases without auth matched the provided filters."
        : "No eval cases matched the provided filters.",
    );
  }
  preflightRequiredProfiles(selectedCases);
  validateCachedAgentSelection(options.agents);
  if (options.gcp && options.repeatCount !== 1) {
    throw new Error(
      "--repeat-count is not supported with --gcp yet. Run separate Cloud Run evals instead.",
    );
  }
  if (!options.gcp) {
    ensureEvalModelCredentials(options.model);
  }

  await mkdir(options.outputDir, { recursive: true });
  const ids = caseIds(selectedCases);
  const targetBaseId = process.env.EVAL_TARGET_BASE_ID?.trim();
  const casesForRun = targetBaseId
    ? selectedCases.filter((evalCase) => ids.get(evalCase) === targetBaseId)
    : selectedCases;
  if (targetBaseId && casesForRun.length === 0) {
    throw new Error(`No eval case matched EVAL_TARGET_BASE_ID=${targetBaseId}.`);
  }
  const selectedProvider = selectedProviderName(options.provider);
  const detectedConcurrency = detectedEvalConcurrency(
    casesForRun.length * options.agents.length,
  );
  const availableParallelism = detectedConcurrency.availableParallelism;
  const maxParallelCases = options.concurrency ?? detectedConcurrency.maxParallelCases;
  const attemptCount =
    casesForRun.length * options.agents.length * options.repeatCount;

  if (options.gcp) {
    const browserProvider = selectedProviderName(options.provider ?? selectedProvider);
    const targets = cloudTargets(casesForRun, ids, options.agents);
    process.stdout.write(
      `Dispatching ${targets.length} eval target(s) to Cloud Run (${casesForRun.length} case(s), ${options.agents.length} agent(s), ${options.repeatCount} repeat(s)).\n`,
    );
    process.stdout.write(`Agents: ${options.agents.join(", ")}\n`);
    process.stdout.write(`Browser provider: ${browserProvider}\n`);
    const dispatch = await dispatchEvalGcpRun({
      model: options.model,
      browserProvider,
      fileFilters: options.fileFilters,
      testNamePattern: options.testNamePattern,
      noAuth: options.noAuth,
      agents: options.agents,
      targets,
      parallelism: options.concurrency,
      image: options.gcpImage,
    });
    process.stdout.write(
      [
        `Dispatched eval run ${dispatch.runId} (${dispatch.totalCases} target(s), parallelism ${dispatch.parallelism}).`,
        `Execution: ${dispatch.executionName}`,
        `Check status: pnpm evals status --run ${dispatch.runId}`,
        `Show results: pnpm evals results --run ${dispatch.runId}`,
        "",
      ].join("\n"),
    );
    return 0;
  }

  process.stdout.write(
    `Running ${casesForRun.length} eval case(s) x ${options.repeatCount} repeat(s) = ${attemptCount} attempt(s)\n`,
  );
  process.stdout.write(
    `Execution: up to ${maxParallelCases} parallel case(s), sequential repeats (detected ${availableParallelism} available CPU(s))\n`,
  );
  process.stdout.write(`Agents: ${options.agents.join(", ")}\n`);
  process.stdout.write(`Browser provider: ${selectedProvider}\n`);
  if (selectedProvider === "kernel") {
    process.stdout.write("Kernel stealth: true\n");
    process.stdout.write("Kernel headful: true\n");
  }
  process.stdout.write(`Output: ${options.outputDir}\n`);

  const previousKernelStealth = process.env.KERNEL_STEALTH;
  const previousKernelHeadless = process.env.KERNEL_HEADLESS;
  if (selectedProvider === "kernel") {
    process.env.KERNEL_STEALTH = "true";
    process.env.KERNEL_HEADLESS = "false";
  }

  let results: CaseResult[] = [];
  try {
    for (
      let repeatIndex = 1;
      repeatIndex <= options.repeatCount;
      repeatIndex += 1
    ) {
      if (options.repeatCount > 1) {
        process.stdout.write(
          `\nRepeat ${repeatIndex}/${options.repeatCount}\n`,
        );
      }
      results = results.concat(
        await runSelectedCases(
          casesForRun,
          ids,
          options,
          repeatIndex,
          maxParallelCases,
        ),
      );
    }
  } finally {
    if (previousKernelStealth === undefined) {
      delete process.env.KERNEL_STEALTH;
    } else {
      process.env.KERNEL_STEALTH = previousKernelStealth;
    }
    if (previousKernelHeadless === undefined) {
      delete process.env.KERNEL_HEADLESS;
    } else {
      process.env.KERNEL_HEADLESS = previousKernelHeadless;
    }
  }

  const completedAttempts = results.filter(
    (result) => result.status === "completed",
  ).length;
  const skippedAttempts = results.filter(
    (result) => result.status === "skipped",
  ).length;
  const erroredAttempts = results.filter(
    (result) => result.status === "error",
  ).length;
  const scorePassedAttempts = results.reduce(
    (total, result) => total + result.score.passed,
    0,
  );
  const scoreTotalAttempts = results.reduce(
    (total, result) => total + result.score.total,
    0,
  );
  const finishedAt = new Date().toISOString();
  const wallDurationMs = Date.now() - startedMs;
  const durationMs = averageDuration(wallDurationMs, options.repeatCount);
  const runId = relative(repoRoot, options.outputDir).startsWith("evals/runs/")
    ? toPosixPath(relative(join(repoRoot, "evals", "runs"), options.outputDir))
    : dirname(options.outputDir) === join(repoRoot, "evals", "runs")
      ? options.outputDir.split(sep).at(-1) ?? options.outputDir
      : options.outputDir.split(sep).at(-1) ?? options.outputDir;
  const agentMetrics = averageMetrics(
    aggregateMetrics(results.map((result) => result.agentMetrics)),
    options.repeatCount,
  );
  const judgeMetrics = averageMetrics(
    aggregateMetrics(results.map((result) => result.judgeMetrics)),
    options.repeatCount,
  );
  const combinedMetrics = aggregateMetrics([agentMetrics, judgeMetrics]);
  const totalCaseDurationMs = averageDuration(
    results.reduce((total, result) => total + result.durationMs, 0),
    options.repeatCount,
  );
  const completed = averageValue(completedAttempts, options.repeatCount);
  const skipped = averageValue(skippedAttempts, options.repeatCount);
  const errored = averageValue(erroredAttempts, options.repeatCount);
  const scorePassed = averageValue(
    scorePassedAttempts,
    options.repeatCount,
  );
  const scoreTotal = averageValue(scoreTotalAttempts, options.repeatCount);
  const completedAttemptDurationMs = results
    .filter((result) => result.status === "completed")
    .reduce((total, result) => total + result.durationMs, 0);
  const averageCompletedDurationMs =
    completedAttempts > 0
      ? Math.round(completedAttemptDurationMs / completedAttempts)
      : null;
  const summary: RunSummary = {
    generatedAt: finishedAt,
    runId,
    startedAt,
    finishedAt,
    durationMs,
    repeatCount: options.repeatCount,
    totalCaseDurationMs,
    averageCompletedDurationMs,
    selectedModel: options.model,
    selectedAgents: options.agents,
    selectedProvider,
    totals: {
      cases: casesForRun.length,
      attempts: results.length,
      completed,
      skipped,
      errored,
      scorePassed,
      scoreTotal,
      scorePercent: scorePercent(scorePassed, scoreTotal),
    },
    infra: summarizeInfra(results, options.repeatCount),
    metrics: {
      agent: agentMetrics,
      judge: judgeMetrics,
      combined: combinedMetrics,
    },
    cases: results.map((result) => ({
      id: result.id,
      baseId: result.baseId,
      repeatIndex: result.repeatIndex,
      repeatCount: result.repeatCount,
      name: result.name,
      agent: result.agent,
      status: result.status,
      durationMs: result.durationMs,
      score: result.score,
      agentMetrics: result.agentMetrics,
      judgeMetrics: result.judgeMetrics,
      combinedMetrics: aggregateMetrics([
        result.agentMetrics,
        result.judgeMetrics,
      ]),
      recordingUrls: result.recordingUrls,
      infraClassification: result.infraClassification,
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
    wallDurationMs,
    repeatCount: options.repeatCount,
    gitSha: gitSha(),
    outputDir: options.outputDir,
    fileFilters: options.fileFilters,
    testNamePattern: options.testNamePattern,
    selectedModel: options.model,
    selectedAgents: options.agents,
    selectedProvider,
    concurrency: options.concurrency,
    noAuth: options.noAuth,
    availableParallelism,
    maxParallelCases,
    totals: summary.totals,
    infra: summary.infra,
    metrics: summary.metrics,
    cases: summary.cases,
  };

  await writeJson(join(options.outputDir, "run.json"), runRecord);
  await writeRedactedJson(join(options.outputDir, "summary.json"), summary);
  await writeFile(
    join(options.outputDir, "summary.md"),
    redactString(buildSummaryMarkdown(summary), sensitiveEnvValues()),
    "utf8",
  );

  process.stdout.write(
    `\nCompleted ${completedAttempts}/${results.length} eval attempt(s); average score ${scorePassed}/${scoreTotal}; average skipped ${skipped}; average errors ${errored}.\n`,
  );
  return erroredAttempts > 0 ? 1 : 0;
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
