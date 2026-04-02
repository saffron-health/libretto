import { execFileSync } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { GoogleAuth } from "google-auth-library";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { z } from "zod";
import { createLLMClient } from "../libretto-internals.js";
import {
  formatSelectionSummary,
  readWebVoyagerRows,
  selectWebVoyagerRows,
  type WebVoyagerRow,
} from "./dataset.js";
import { buildWebVoyagerPrompt, getRunName } from "./prompt.js";
import { ScreenshotCollector } from "./screenshot-collector.js";
import { evaluateWithScreenshots, type JudgeResult } from "./evaluator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebVoyagerCaseResult = {
  caseId: string;
  runDir: string;
  status: "passed" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  finalMessage: string | null;
  judge: JudgeResult;
  screenshotCount: number;
  error: string | null;
};

type TranscriptUsageEntry = {
  timestamp: string | null;
  model: string | null;
  provider: string | null;
  responseId: string | null;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  requestContextTokens: number;
  costUsd: number | null;
};

type TranscriptUsageSummary = {
  assistantTurnCount: number;
  turnsWithUsage: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalTokens: number;
  maxInputTokens: number;
  maxRequestContextTokens: number;
  maxOutputTokens: number;
  totalCostUsd: number | null;
  turns: TranscriptUsageEntry[];
};

// ---------------------------------------------------------------------------
// Constants & env tunables
// ---------------------------------------------------------------------------

const BENCHMARK_NAME = "webVoyager";
const BENCHMARK_MODEL_PROVIDER = "anthropic";
const BENCHMARK_MODEL_ID = "claude-opus-4-6";
const DEFAULT_GCP_PROJECT = "saffron-health";
const DEFAULT_ANTHROPIC_SECRET_NAME = "anthropic-api-key";
const BENCHMARK_SNAPSHOT_MODEL = "vertex/gemini-2.5-flash";

const repoRoot = resolve(import.meta.dirname, "../..");
const librettoPackageRoot = resolve(repoRoot, "packages", "libretto");
const librettoPackageManifest = readLibrettoPackageManifest();
const rootPackageManager = readRootPackageManager();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const typedMessage = message as {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (
    typedMessage.role !== "assistant" ||
    !Array.isArray(typedMessage.content)
  ) {
    return "";
  }

  return typedMessage.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part?.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function readLibrettoPackageManifest(): {
  peerDependencies?: Record<string, string>;
} {
  try {
    const packageJsonPath = resolve(librettoPackageRoot, "package.json");
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      peerDependencies?: Record<string, string>;
    };
  } catch {
    return {};
  }
}

function readRootPackageManager(): string {
  try {
    const packageJsonPath = resolve(repoRoot, "package.json");
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      packageManager?: unknown;
    };
    return typeof parsed.packageManager === "string"
      ? parsed.packageManager
      : "pnpm@9.15.4";
  } catch {
    return "pnpm@9.15.4";
  }
}

function resolveSnapshotModelForBenchmarkWorkspace(): string {
  return BENCHMARK_SNAPSHOT_MODEL;
}

function resolveBenchmarkWorkspaceProjectId(): string | null {
  return (
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.LIBRETTO_BENCHMARK_GCP_PROJECT?.trim() ||
    null
  );
}

async function writeBenchmarkWorkspaceEnvFile(runDir: string): Promise<void> {
  const projectId = resolveBenchmarkWorkspaceProjectId();
  if (!projectId) {
    return;
  }

  await writeFile(
    join(runDir, ".env"),
    [
      "# Benchmark workspace runtime configuration",
      `GOOGLE_CLOUD_PROJECT=${projectId}`,
      `GCLOUD_PROJECT=${projectId}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function resolveProviderPackageForModel(model: string): string | null {
  const provider = model.split("/", 1)[0]?.toLowerCase();
  if (!provider) {
    return null;
  }

  switch (provider) {
    case "anthropic":
      return "@ai-sdk/anthropic";
    case "google":
    case "gemini":
      return "@ai-sdk/google";
    case "vertex":
      return "@ai-sdk/google-vertex";
    case "openai":
    case "codex":
      return "@ai-sdk/openai";
    default:
      return null;
  }
}

function resolveProviderInstallSpec(model: string): string | null {
  const packageName = resolveProviderPackageForModel(model);
  if (!packageName) {
    return null;
  }

  const version = librettoPackageManifest.peerDependencies?.[packageName];
  return version ? `${packageName}@${version}` : packageName;
}

function runWorkspaceCommand(
  runDir: string,
  command: string,
  args: string[],
): void {
  try {
    execFileSync(command, args, {
      cwd: runDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
  } catch (error) {
    const details =
      typeof error === "object" && error !== null
        ? (error as { stdout?: string | Buffer; stderr?: string | Buffer })
        : {};
    const stdout =
      typeof details.stdout === "string"
        ? details.stdout.trim()
        : Buffer.isBuffer(details.stdout)
          ? details.stdout.toString("utf8").trim()
          : "";
    const stderr =
      typeof details.stderr === "string"
        ? details.stderr.trim()
        : Buffer.isBuffer(details.stderr)
          ? details.stderr.toString("utf8").trim()
          : "";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Failed to run ${command} ${args.join(" ")} in ${runDir}.`,
        message,
        stdout ? `stdout:\n${stdout}` : null,
        stderr ? `stderr:\n${stderr}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
}

function toTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatTranscriptTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  return null;
}

function collectTranscriptUsageEntry(event: AgentSessionEvent): TranscriptUsageEntry | null {
  if (event.type !== "message_end") {
    return null;
  }

  const typedEvent = event as AgentSessionEvent & {
    message?: {
      role?: string;
      timestamp?: string | number;
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        totalTokens?: number;
        cost?: { total?: number };
      };
      model?: string;
      provider?: string;
      responseId?: string;
      stopReason?: string;
      timestamp?: string | number;
    };
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
      cost?: { total?: number };
    };
    model?: string;
    provider?: string;
    responseId?: string;
    stopReason?: string;
    timestamp?: string | number;
  };

  if (typedEvent.message?.role !== "assistant") {
    return null;
  }

  const usage = typedEvent.usage ?? typedEvent.message?.usage;
  const inputTokens = toTokenCount(usage?.input);
  const outputTokens = toTokenCount(usage?.output);
  const cacheReadTokens = toTokenCount(usage?.cacheRead);
  const cacheWriteTokens = toTokenCount(usage?.cacheWrite);
  const totalTokens = toTokenCount(usage?.totalTokens);

  return {
    timestamp: formatTranscriptTimestamp(
      typedEvent.timestamp ?? typedEvent.message?.timestamp,
    ),
    model:
      typeof (typedEvent.model ?? typedEvent.message?.model) === "string"
        ? (typedEvent.model ?? typedEvent.message?.model)
        : null,
    provider:
      typeof (typedEvent.provider ?? typedEvent.message?.provider) === "string"
        ? (typedEvent.provider ?? typedEvent.message?.provider)
        : null,
    responseId:
      typeof (typedEvent.responseId ?? typedEvent.message?.responseId) ===
      "string"
        ? (typedEvent.responseId ?? typedEvent.message?.responseId)
        : null,
    stopReason:
      typeof (typedEvent.stopReason ?? typedEvent.message?.stopReason) ===
      "string"
        ? (typedEvent.stopReason ?? typedEvent.message?.stopReason)
        : null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    requestContextTokens: inputTokens + cacheReadTokens,
    costUsd: toOptionalNumber(usage?.cost?.total),
  };
}

function summarizeTranscriptUsage(
  turns: TranscriptUsageEntry[],
): TranscriptUsageSummary {
  const totals = turns.reduce(
    (acc, turn) => {
      acc.totalInputTokens += turn.inputTokens;
      acc.totalOutputTokens += turn.outputTokens;
      acc.totalCacheReadTokens += turn.cacheReadTokens;
      acc.totalCacheWriteTokens += turn.cacheWriteTokens;
      acc.totalTokens += turn.totalTokens;
      acc.maxInputTokens = Math.max(acc.maxInputTokens, turn.inputTokens);
      acc.maxRequestContextTokens = Math.max(
        acc.maxRequestContextTokens,
        turn.requestContextTokens,
      );
      acc.maxOutputTokens = Math.max(acc.maxOutputTokens, turn.outputTokens);

      if (turn.costUsd != null) {
        acc.totalCostUsd = (acc.totalCostUsd ?? 0) + turn.costUsd;
      }

      return acc;
    },
    {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalTokens: 0,
      maxInputTokens: 0,
      maxRequestContextTokens: 0,
      maxOutputTokens: 0,
      totalCostUsd: null as number | null,
    },
  );

  return {
    assistantTurnCount: turns.length,
    turnsWithUsage: turns.filter(
      (turn) =>
        turn.inputTokens > 0 ||
        turn.outputTokens > 0 ||
        turn.cacheReadTokens > 0 ||
        turn.cacheWriteTokens > 0 ||
        turn.totalTokens > 0,
    ).length,
    totalInputTokens: totals.totalInputTokens,
    totalOutputTokens: totals.totalOutputTokens,
    totalCacheReadTokens: totals.totalCacheReadTokens,
    totalCacheWriteTokens: totals.totalCacheWriteTokens,
    totalTokens: totals.totalTokens,
    maxInputTokens: totals.maxInputTokens,
    maxRequestContextTokens: totals.maxRequestContextTokens,
    maxOutputTokens: totals.maxOutputTokens,
    totalCostUsd: totals.totalCostUsd,
    turns,
  };
}

function formatUsd(value: number | null): string {
  return value == null ? "-" : `$${value.toFixed(4)}`;
}

async function writeTranscriptAnalysis(
  runDir: string,
  summary: TranscriptUsageSummary,
): Promise<string> {
  const analysisPath = join(runDir, "transcript-analysis.md");
  const lines = [
    "# Transcript Analysis",
    "",
    "## Context / token usage summary",
    "",
    `- Assistant turns: ${summary.assistantTurnCount}`,
    `- Turns with usage metadata: ${summary.turnsWithUsage}`,
    `- Total input tokens: ${summary.totalInputTokens}`,
    `- Total output tokens: ${summary.totalOutputTokens}`,
    `- Total cache read tokens: ${summary.totalCacheReadTokens}`,
    `- Total cache write tokens: ${summary.totalCacheWriteTokens}`,
    `- Total billed tokens: ${summary.totalTokens}`,
    `- Max input tokens in a single turn: ${summary.maxInputTokens}`,
    `- Max request context tokens (input + cache read): ${summary.maxRequestContextTokens}`,
    `- Max output tokens in a single turn: ${summary.maxOutputTokens}`,
    `- Total model cost: ${formatUsd(summary.totalCostUsd)}`,
    "",
    "## Per-turn context usage",
    "",
  ];

  if (summary.turns.length === 0) {
    lines.push("No assistant turns were recorded in the transcript.");
  } else {
    lines.push(
      "| # | Timestamp | Provider / Model | Stop reason | Input | Cache read | Cache write | Output | Total | Context | Cost |",
      "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
    );

    summary.turns.forEach((turn, index) => {
      lines.push(
        `| ${index + 1} | ${turn.timestamp ?? "-"} | ${turn.provider ?? "-"} / ${turn.model ?? "-"} | ${turn.stopReason ?? "-"} | ${turn.inputTokens} | ${turn.cacheReadTokens} | ${turn.cacheWriteTokens} | ${turn.outputTokens} | ${turn.totalTokens} | ${turn.requestContextTokens} | ${formatUsd(turn.costUsd)} |`,
      );
    });
  }

  await writeFile(analysisPath, `${lines.join("\n")}\n`, "utf8");
  return analysisPath;
}

function readTranscriptUsageSummary(
  transcriptPath: string,
): TranscriptUsageSummary {
  const raw = readFileSync(transcriptPath, "utf8");
  const turns: TranscriptUsageEntry[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as AgentSessionEvent;
      const usageEntry = collectTranscriptUsageEntry(parsed);
      if (usageEntry) {
        turns.push(usageEntry);
      }
    } catch {
      // Ignore malformed lines in analysis output; the raw transcript remains the source of truth.
    }
  }

  return summarizeTranscriptUsage(turns);
}

// ---------------------------------------------------------------------------
// GCP / Anthropic key management
// ---------------------------------------------------------------------------

async function accessSecretVersion(args: {
  projectId: string;
  secretName: string;
}): Promise<string> {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const { data } = await client.request<{ payload?: { data?: string } }>({
    url: `https://secretmanager.googleapis.com/v1/projects/${args.projectId}/secrets/${args.secretName}/versions/latest:access`,
    method: "GET",
  });

  const encoded = data.payload?.data?.trim();
  if (!encoded) {
    throw new Error(
      `Secret ${args.secretName} in project ${args.projectId} did not return a payload.`,
    );
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
  if (!decoded) {
    throw new Error(
      `Secret ${args.secretName} in project ${args.projectId} decoded to an empty string.`,
    );
  }

  return decoded;
}

async function ensureBenchmarkProjectEnv(): Promise<string> {
  const existingProjectId =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.LIBRETTO_BENCHMARK_GCP_PROJECT?.trim();
  if (existingProjectId) {
    process.env.GOOGLE_CLOUD_PROJECT ??= existingProjectId;
    process.env.GCLOUD_PROJECT ??= existingProjectId;
    return existingProjectId;
  }

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const projectId = (await auth.getProjectId()) || DEFAULT_GCP_PROJECT;

  process.env.GOOGLE_CLOUD_PROJECT ??= projectId;
  process.env.GCLOUD_PROJECT ??= projectId;
  return projectId;
}

async function ensureAnthropicApiKey(): Promise<string> {
  const projectId = await ensureBenchmarkProjectEnv();
  const existing = process.env.ANTHROPIC_API_KEY?.trim();
  if (existing) {
    return existing;
  }

  const secretName =
    process.env.LIBRETTO_BENCHMARK_ANTHROPIC_SECRET_NAME?.trim() ||
    DEFAULT_ANTHROPIC_SECRET_NAME;
  const apiKey = await accessSecretVersion({ projectId, secretName });

  process.env.ANTHROPIC_API_KEY = apiKey;
  return apiKey;
}

// ---------------------------------------------------------------------------
// Workspace preparation
// ---------------------------------------------------------------------------

async function prepareRunWorkspace(
  row: WebVoyagerRow,
): Promise<{ runDir: string; prompt: string; sessionName: string }> {
  const runDir = resolve(
    repoRoot,
    "benchmarks",
    BENCHMARK_NAME,
    "runs",
    getRunName(row),
  );
  const { text: prompt, sessionName } = buildWebVoyagerPrompt(row);
  const snapshotModel = resolveSnapshotModelForBenchmarkWorkspace();
  const snapshotProviderInstallSpec = resolveProviderInstallSpec(snapshotModel);

  await rm(runDir, { recursive: true, force: true });
  await mkdir(runDir, { recursive: true });
  await mkdir(join(runDir, ".agents"), { recursive: true });

  await writeFile(
    join(runDir, "package.json"),
    JSON.stringify(
      {
        name: `libretto-benchmark-${getRunName(row)}`,
        private: true,
        type: "module",
        packageManager: rootPackageManager,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    join(runDir, "AGENTS.md"),
    [
      "# Benchmark Workspace Rules",
      "",
      "- Use the libretto skill in this workspace.",
      "- Use the local CLI via `npx libretto ...`.",
      `- Libretto snapshot analysis is preconfigured to \`${snapshotModel}\`; do not run \`libretto ai configure\` to change it.`,
      "- Do not inspect sibling benchmark files or parent benchmark directories to discover the answer.",
      "- End with a direct final answer to the task.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(runDir, "prompt.md"), `${prompt}\n`, "utf8");
  await writeBenchmarkWorkspaceEnvFile(runDir);

  runWorkspaceCommand(runDir, "git", ["init", "-q"]);
  runWorkspaceCommand(runDir, "pnpm", [
    "add",
    "--lockfile=false",
    `file:${librettoPackageRoot}`,
    ...(snapshotProviderInstallSpec ? [snapshotProviderInstallSpec] : []),
  ]);
  runWorkspaceCommand(runDir, "npx", [
    "libretto",
    "setup",
    "--skip-browsers",
  ]);
  runWorkspaceCommand(runDir, "npx", [
    "libretto",
    "ai",
    "configure",
    snapshotModel,
  ]);

  return { runDir, prompt, sessionName };
}

// ---------------------------------------------------------------------------
// Save screenshots as artifacts
// ---------------------------------------------------------------------------

async function saveEvaluatorArtifacts(
  runDir: string,
  screenshots: Buffer[],
  judge: JudgeResult,
  task: string,
  agentReasoning: string | null,
): Promise<{ screenshotPaths: string[]; analysisPath: string }> {
  const evalDir = join(runDir, "evaluator");
  const screenshotsDir = join(evalDir, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });

  // Save screenshots
  const screenshotPaths: string[] = [];
  for (let i = 0; i < screenshots.length; i++) {
    const filename = `screenshot-${String(i + 1).padStart(2, "0")}.png`;
    const filePath = join(screenshotsDir, filename);
    await writeFile(filePath, screenshots[i]);
    screenshotPaths.push(filePath);
  }

  // Write analysis markdown
  const analysisPath = join(evalDir, "analysis.md");
  const analysisLines = [
    `# Evaluator Analysis`,
    "",
    `## Task`,
    "",
    task,
    "",
    `## Verdict: ${judge.evaluation}`,
    "",
    judge.reasoning,
    "",
    `## Evidence`,
    "",
    `Screenshots: ${screenshots.length}`,
    "",
    ...screenshotPaths.map((p, i) => `- Screenshot ${i + 1}: ${p}`),
    "",
  ];

  if (agentReasoning?.trim()) {
    analysisLines.push(`## Agent Reasoning`, "", agentReasoning.trim(), "");
  }

  await writeFile(analysisPath, analysisLines.join("\n"), "utf8");

  return { screenshotPaths, analysisPath };
}

// ---------------------------------------------------------------------------
// Run a single case
// ---------------------------------------------------------------------------

export async function runWebVoyagerCase(
  row: WebVoyagerRow,
): Promise<WebVoyagerCaseResult> {
  const startedAt = new Date();
  const anthropicApiKey = await ensureAnthropicApiKey();
  const { runDir, prompt, sessionName } = await prepareRunWorkspace(row);
  const agentDir = join(runDir, ".pi");
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
  authStorage.setRuntimeApiKey("anthropic", anthropicApiKey);

  const modelRegistry = new ModelRegistry(authStorage);
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
  });
  const localSkillsRoot = join(runDir, ".agents", "skills");
  const resourceLoader = new DefaultResourceLoader({
    cwd: runDir,
    agentDir,
    settingsManager,
    skillsOverride: (current) => ({
      skills: current.skills.filter((skill) =>
        skill.filePath.startsWith(localSkillsRoot),
      ),
      diagnostics: current.diagnostics,
    }),
  });
  await resourceLoader.reload();

  if (
    !resourceLoader
      .getSkills()
      .skills.some((skill) => skill.name === "libretto")
  ) {
    throw new Error(
      "Failed to load the local libretto skill into the benchmark workspace.",
    );
  }

  const model = modelRegistry.find(
    BENCHMARK_MODEL_PROVIDER,
    BENCHMARK_MODEL_ID,
  );
  if (!model) {
    throw new Error(
      `Unknown Pi model: ${BENCHMARK_MODEL_PROVIDER}/${BENCHMARK_MODEL_ID}`,
    );
  }

  const { session } = await createAgentSession({
    cwd: runDir,
    agentDir,
    model,
    thinkingLevel: "medium",
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  // Only keep meaningful transcript events (not streaming deltas).
  const TRANSCRIPT_EVENT_TYPES = new Set([
    "message_end",
    "tool_execution_start",
    "tool_execution_end",
  ]);

  const transcriptPath = join(runDir, "transcript.jsonl");
  const transcriptStream = createWriteStream(transcriptPath, { flags: "w" });
  transcriptStream.write(
    `${JSON.stringify({
      ts: startedAt.toISOString(),
      type: "user_prompt",
      text: prompt,
    })}\n`,
  );

  let finalMessage: string | null = null;
  let thrownError: unknown;

  // Start screenshot collection on the libretto browser session
  const screenshotCollector = new ScreenshotCollector(sessionName, runDir);
  screenshotCollector.start();

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (TRANSCRIPT_EVENT_TYPES.has(event.type)) {
      transcriptStream.write(`${JSON.stringify(event)}\n`);
    }

    switch (event.type) {
      case "message_end": {
        const messageText = extractAssistantText(event.message);
        if (!messageText) {
          break;
        }

        finalMessage = messageText;
        break;
      }
    }
  });

  try {
    await session.prompt(prompt);
  } catch (error) {
    thrownError = error;
  } finally {
    unsubscribe();
    session.dispose();
    transcriptStream.end();
    await finished(transcriptStream);
  }

  // Collect screenshots and evaluate
  const screenshots = await screenshotCollector.stop();

  // Evaluate using screenshot-based LLM judge
  const judge = await evaluateWithScreenshots({
    task: row.ques,
    screenshots,
    agentReasoning: finalMessage,
  });

  // Persist evaluator artifacts
  const { screenshotPaths, analysisPath } = await saveEvaluatorArtifacts(
    runDir,
    screenshots,
    judge,
    row.ques,
    finalMessage,
  );
  const transcriptAnalysisPath = await writeTranscriptAnalysis(
    runDir,
    readTranscriptUsageSummary(transcriptPath),
  );

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const errorMessage =
    thrownError instanceof Error
      ? thrownError.message
      : thrownError
        ? String(thrownError)
        : null;

  // INVALID judge verdicts are treated as failures
  const status: "passed" | "failed" =
    !errorMessage && judge.evaluation === "YES" ? "passed" : "failed";

  const result: WebVoyagerCaseResult = {
    caseId: row.id,
    runDir,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    finalMessage,
    judge,
    screenshotCount: screenshots.length,
    error: errorMessage,
  };

  await writeFile(
    join(runDir, "result.json"),
    JSON.stringify(
      {
        ...result,
        task: row.ques,
        url: row.web,
        screenshotPaths,
        analysisPath,
        transcriptAnalysisPath,
      },
      null,
      2,
    ),
    "utf8",
  );

  return result;
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

export async function runWebVoyagerBenchmark(args: {
  offset?: number;
  count?: number;
  seed?: number;
  random?: boolean;
  parallelize?: number;
}): Promise<{ exitCode: number; stdout: string }> {
  const selection = selectWebVoyagerRows(readWebVoyagerRows(), args);
  const results: WebVoyagerCaseResult[] = [];
  const concurrency = args.parallelize ?? 1;

  console.log(
    `Running WebVoyager benchmark: ${formatSelectionSummary(selection)}${concurrency > 1 ? ` (parallelism: ${concurrency})` : ""}.`,
  );

  if (concurrency <= 1) {
    // Sequential execution (original behaviour)
    for (const [index, row] of selection.rows.entries()) {
      console.log(
        `[${index + 1}/${selection.rows.length}] ${row.id}: ${row.web_name ?? row.web}: ${row.ques}`,
      );
      const result = await runWebVoyagerCase(row);
      results.push(result);

      const verdict = result.judge.evaluation;
      console.log(
        `${result.status === "passed" ? "Passed" : "Failed"} (${verdict}) ${row.id}: ${result.judge.reasoning}`,
      );
    }
  } else {
    // Parallel execution with bounded concurrency
    let nextIndex = 0;
    const total = selection.rows.length;
    const orderedResults: (WebVoyagerCaseResult | undefined)[] = new Array(
      total,
    );

    async function worker(): Promise<void> {
      while (nextIndex < total) {
        const idx = nextIndex++;
        const row = selection.rows[idx];
        console.log(
          `[${idx + 1}/${total}] START ${row.id}: ${row.web_name ?? row.web}: ${row.ques}`,
        );
        const result = await runWebVoyagerCase(row);
        orderedResults[idx] = result;

        const verdict = result.judge.evaluation;
        console.log(
          `[${idx + 1}/${total}] ${result.status === "passed" ? "PASSED" : "FAILED"} (${verdict}) ${row.id}: ${result.judge.reasoning}`,
        );
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, total) }, () =>
      worker(),
    );
    await Promise.all(workers);

    for (const r of orderedResults) {
      if (r) results.push(r);
    }
  }

  const failedCount = results.filter(
    (result) => result.status === "failed",
  ).length;
  const passedCount = results.length - failedCount;
  const exitCode = failedCount > 0 ? 1 : 0;

  return {
    exitCode,
    stdout: [
      "Completed WebVoyager benchmark run.",
      `Selection: ${formatSelectionSummary(selection)}.`,
      `Passed: ${passedCount}`,
      `Failed: ${failedCount}`,
      `Runs: benchmarks/webVoyager/runs/`,
      exitCode === 0
        ? "No further action required."
        : "Review failed run directories under benchmarks/webVoyager/runs/.",
    ].join("\n"),
  };
}
