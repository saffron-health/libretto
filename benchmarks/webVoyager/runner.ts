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

type WebVoyagerCaseResult = {
  caseId: string;
  runDir: string;
  status: "passed" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  finalMessage: string | null;
  evaluationReason: string;
  error: string | null;
};

type EvaluationResult = {
  success: boolean;
  reason: string;
};

const BENCHMARK_NAME = "webVoyager";
const BENCHMARK_MODEL_PROVIDER = "anthropic";
const BENCHMARK_MODEL_ID = "claude-opus-4-6";
const EVALUATOR_MODEL = "anthropic/claude-sonnet-4-6";
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

const EvaluationSchema = z.object({
  success: z.boolean(),
  reason: z.string().trim().min(1),
});

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

async function prepareRunWorkspace(
  row: WebVoyagerRow,
): Promise<{ runDir: string; prompt: string }> {
  const runDir = resolve(
    repoRoot,
    "benchmarks",
    BENCHMARK_NAME,
    "runs",
    getRunName(row),
  );
  const skillDestination = join(runDir, ".agents", "skills", "libretto");
  const prompt = buildWebVoyagerPrompt(row, runDir);

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

  return { runDir, prompt };
}

async function evaluateFinalMessage(
  row: WebVoyagerRow,
  finalMessage: string | null,
): Promise<EvaluationResult> {
  if (!finalMessage?.trim()) {
    return {
      success: false,
      reason: "No final assistant message was recorded.",
    };
  }

  const client = createLLMClient(EVALUATOR_MODEL);
  return await client.generateObject({
    schema: EvaluationSchema,
    temperature: 0,
    prompt: [
      "Evaluate whether the final assistant message answers the benchmark task.",
      "Return only JSON matching the schema.",
      "Use only the final assistant message as evidence.",
      "Mark success=false if the message is incomplete, blocked, purely process narration, or does not materially answer the task.",
      "",
      `Task: ${row.ques}`,
      `Website: ${row.web}`,
      "",
      "Final assistant message:",
      finalMessage,
    ].join("\n"),
  });
}

async function runWebVoyagerCase(
  row: WebVoyagerRow,
): Promise<WebVoyagerCaseResult> {
  const startedAt = new Date();
  const { runDir, prompt } = await prepareRunWorkspace(row);
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

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    transcriptStream.write(`${JSON.stringify(event)}\n`);

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

  const evaluation = await evaluateFinalMessage(row, finalMessage);
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const errorMessage =
    thrownError instanceof Error
      ? thrownError.message
      : thrownError
        ? String(thrownError)
        : null;
  const status: "passed" | "failed" =
    !errorMessage && evaluation.success ? "passed" : "failed";
  const result: WebVoyagerCaseResult = {
    caseId: row.id,
    runDir,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    finalMessage,
    evaluationReason: evaluation.reason,
    error: errorMessage,
  };

  await writeFile(
    join(runDir, "result.json"),
    JSON.stringify(
      {
        ...result,
        task: row.ques,
        url: row.web,
      },
      null,
      2,
    ),
    "utf8",
  );

  return result;
}

export async function runWebVoyagerBenchmark(args: {
  offset?: number;
  count?: number;
  seed?: number;
  random?: boolean;
}): Promise<{ exitCode: number; stdout: string }> {
  const selection = selectWebVoyagerRows(readWebVoyagerRows(), args);
  const results: WebVoyagerCaseResult[] = [];

  console.log(
    `Running WebVoyager benchmark: ${formatSelectionSummary(selection)}.`,
  );

  for (const [index, row] of selection.rows.entries()) {
    console.log(
      `[${index + 1}/${selection.rows.length}] ${row.id}: ${row.web_name ?? row.web}: ${row.ques}`,
    );
    const result = await runWebVoyagerCase(row);
    results.push(result);
    console.log(
      `${result.status === "passed" ? "Passed" : "Failed"} ${row.id}: ${result.evaluationReason}`,
    );
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
