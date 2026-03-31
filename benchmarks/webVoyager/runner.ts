import { createWriteStream, readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
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
import {
  buildWebVoyagerPrompt,
  getRunName,
  rewriteBenchmarkSkillCommands,
} from "./prompt.js";
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

// ---------------------------------------------------------------------------
// Constants & env tunables
// ---------------------------------------------------------------------------

const BENCHMARK_NAME = "webVoyager";
const BENCHMARK_MODEL_PROVIDER = "anthropic";
const BENCHMARK_MODEL_ID = "claude-opus-4-6";
const DEFAULT_GCP_PROJECT = "saffron-health";
const DEFAULT_ANTHROPIC_SECRET_NAME = "anthropic-api-key";

const repoRoot = resolve(import.meta.dirname, "../..");
const librettoPackageRoot = resolve(repoRoot, "packages", "libretto");
const librettoSkillSourcePath = resolve(
  librettoPackageRoot,
  "skills",
  "libretto",
);
const distSourcePath = resolve(librettoPackageRoot, "dist");

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

async function ensureAnthropicApiKey(): Promise<string> {
  const existing = process.env.ANTHROPIC_API_KEY?.trim();
  if (existing) {
    return existing;
  }

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const projectId =
    process.env.LIBRETTO_BENCHMARK_GCP_PROJECT?.trim() ||
    (await auth.getProjectId()) ||
    DEFAULT_GCP_PROJECT;
  const secretName =
    process.env.LIBRETTO_BENCHMARK_ANTHROPIC_SECRET_NAME?.trim() ||
    DEFAULT_ANTHROPIC_SECRET_NAME;
  const apiKey = await accessSecretVersion({ projectId, secretName });

  process.env.ANTHROPIC_API_KEY = apiKey;
  process.env.GOOGLE_CLOUD_PROJECT ??= projectId;
  process.env.GCLOUD_PROJECT ??= projectId;
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
  const skillDestination = join(runDir, ".agents", "skills", "libretto");
  const { text: prompt, sessionName } = buildWebVoyagerPrompt(row);

  await rm(runDir, { recursive: true, force: true });
  await mkdir(runDir, { recursive: true });
  await cp(distSourcePath, join(runDir, "dist"), { recursive: true });
  await cp(librettoSkillSourcePath, skillDestination, { recursive: true });
  await writeFile(
    join(skillDestination, "SKILL.md"),
    rewriteBenchmarkSkillCommands(
      readFileSync(join(skillDestination, "SKILL.md"), "utf8"),
    ),
    "utf8",
  );

  await writeFile(
    join(runDir, "package.json"),
    JSON.stringify(
      {
        name: `libretto-benchmark-${getRunName(row)}`,
        private: true,
        type: "module",
        scripts: {
          cli: "LIBRETTO_REPO_ROOT=. node ./dist/cli/index.js",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await mkdir(join(runDir, "node_modules"), { recursive: true });
  await writeFile(
    join(runDir, "AGENTS.md"),
    [
      "# Benchmark Workspace Rules",
      "",
      "- Use the libretto skill in this workspace.",
      "- Use the local CLI via `pnpm -s cli ...`.",
      "- Do not inspect sibling benchmark files or parent benchmark directories to discover the answer.",
      "- End with a direct final answer to the task.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(runDir, "prompt.md"), `${prompt}\n`, "utf8");

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
  const { runDir, prompt, sessionName } = await prepareRunWorkspace(row);
  const anthropicApiKey = await ensureAnthropicApiKey();
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
