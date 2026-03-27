import { readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
import { SimpleCLI } from "../../src/cli/framework/simple-cli.js";
import { createLLMClient } from "../../src/shared/llm/client.js";

export type WebVoyagerRow = {
  id: string;
  web: string;
  ques: string;
  web_name?: string;
};

export type WebVoyagerSelection = {
  mode: "slice" | "random";
  offset: number;
  count: number | null;
  seed: number | null;
  totalCaseCount: number;
  selectedCaseCount: number;
  rows: WebVoyagerRow[];
};

export type WebVoyagerCaseResult = {
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

type ToolStartRecord = {
  toolName: string;
  args: unknown;
};

type EvaluationResult = {
  success: boolean;
  reason: string;
};

const BENCHMARK_NAME = "webVoyager";
const DEFAULT_RANDOM_SEED = 1;
const BENCHMARK_MODEL_PROVIDER = "anthropic";
const BENCHMARK_MODEL_ID = "claude-opus-4-6";
const EVALUATOR_MODEL = "anthropic/claude-sonnet-4-6";
const DEFAULT_GCP_PROJECT = "saffron-health";
const DEFAULT_ANTHROPIC_SECRET_NAME = "anthropic-api-key";

const MARKDOWN_ARGS_LIMIT = 2_000;
const MARKDOWN_OUTPUT_LIMIT = 8_000;

const repoRoot = resolve(import.meta.dirname, "../..");
const webVoyagerCasesPath = resolve(import.meta.dirname, "cases.jsonl");
const librettoSkillSourcePath = resolve(repoRoot, "skills", "libretto");
const distSourcePath = resolve(repoRoot, "dist");

const EvaluationSchema = z.object({
  success: z.boolean(),
  reason: z.string().trim().min(1),
});

let anthropicApiKeyPromise: Promise<string> | null = null;

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function formatSessionName(caseId: string): string {
  return slugify(`${BENCHMARK_NAME}-${caseId}`);
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleRows(rows: WebVoyagerRow[], seed: number): WebVoyagerRow[] {
  const random = createSeededRandom(seed);
  const shuffled = [...rows];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function formatCaseLabel(row: WebVoyagerRow): string {
  return `${row.id}: ${row.web_name ?? row.web}: ${row.ques}`;
}

function getRunName(row: WebVoyagerRow): string {
  const siteSlug = slugify(row.web_name ?? new URL(row.web).hostname);
  return slugify(`${siteSlug}-${row.id}`);
}

export function getWebVoyagerCasesPath(): string {
  return webVoyagerCasesPath;
}

export function parseWebVoyagerRows(jsonl: string): WebVoyagerRow[] {
  const lines = jsonl
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const parsed = JSON.parse(line) as Partial<WebVoyagerRow>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.web !== "string" ||
      typeof parsed.ques !== "string"
    ) {
      throw new Error(`Invalid WebVoyager row: ${line}`);
    }

    return {
      id: parsed.id,
      web: parsed.web,
      ques: parsed.ques,
      web_name: typeof parsed.web_name === "string" ? parsed.web_name : undefined,
    };
  });
}

export function readWebVoyagerRows(
  filePath: string = getWebVoyagerCasesPath(),
): WebVoyagerRow[] {
  return parseWebVoyagerRows(readFileSync(filePath, "utf8"));
}

export function selectWebVoyagerRows(
  rows: WebVoyagerRow[],
  options: {
    offset?: number;
    count?: number;
    seed?: number;
    random?: boolean;
  },
): WebVoyagerSelection {
  const totalCaseCount = rows.length;
  const offset = options.offset ?? 0;
  const count = options.count ?? null;
  const seed = options.seed ?? DEFAULT_RANDOM_SEED;
  const mode = options.random ? "random" : "slice";

  if (totalCaseCount === 0) {
    throw new Error("WebVoyager cases.jsonl is empty.");
  }

  if (offset < 0) {
    throw new Error(`--offset must be non-negative. Received: ${offset}`);
  }

  if (count != null && count <= 0) {
    throw new Error(`--count must be positive. Received: ${count}`);
  }

  if (mode === "random") {
    const sampleCount = count ?? totalCaseCount;
    if (sampleCount > totalCaseCount) {
      throw new Error(
        `Cannot randomly select ${sampleCount} case(s) from ${totalCaseCount} available WebVoyager cases.`,
      );
    }

    const selectedRows = shuffleRows(rows, seed).slice(0, sampleCount);
    return {
      mode,
      offset: 0,
      count: sampleCount,
      seed,
      totalCaseCount,
      selectedCaseCount: selectedRows.length,
      rows: selectedRows,
    };
  }

  if (offset >= totalCaseCount) {
    throw new Error(
      `--offset ${offset} is out of range for ${totalCaseCount} WebVoyager cases.`,
    );
  }

  const selectedRows = rows.slice(offset, count == null ? undefined : offset + count);
  return {
    mode,
    offset,
    count,
    seed: null,
    totalCaseCount,
    selectedCaseCount: selectedRows.length,
    rows: selectedRows,
  };
}

export function rewriteBenchmarkSkillCommands(markdown: string): string {
  return markdown.replaceAll("npx libretto", "pnpm -s cli");
}

export function buildWebVoyagerPrompt(row: WebVoyagerRow, runDir: string): string {
  const sessionName = formatSessionName(row.id);

  return [
    `Run the ${BENCHMARK_NAME} benchmark case \"${formatCaseLabel(row)}\".`,
    `Current working directory: ${runDir}`,
    "Use the libretto skill available in this workspace.",
    "Use the local Libretto CLI via `pnpm -s cli ...`.",
    `Use exactly one Libretto session named \"${sessionName}\".`,
    `Open the site with: pnpm -s cli open ${row.web} --headless --session ${sessionName}`,
    `Before finishing, run: pnpm -s cli exec --session ${sessionName} \"return { url: await page.url(), title: await page.title() }\"`,
    `Then close the browser with: pnpm -s cli close --session ${sessionName}`,
    "Do not inspect sibling benchmark files or parent benchmark directories to discover the answer.",
    "Your final message should directly answer the task. If you are blocked, explain the blocker clearly in the final message.",
    "",
    "Task:",
    row.ques,
  ].join("\n");
}

function formatSelectionSummary(selection: WebVoyagerSelection): string {
  if (selection.mode === "random") {
    return `random sample of ${selection.selectedCaseCount} case(s) from ${selection.totalCaseCount} total (seed ${selection.seed ?? DEFAULT_RANDOM_SEED})`;
  }

  if (selection.count == null) {
    return `slice from offset ${selection.offset} through the remaining ${selection.selectedCaseCount} case(s) of ${selection.totalCaseCount}`;
  }

  return `slice of ${selection.selectedCaseCount} case(s) from offset ${selection.offset} (requested count ${selection.count}) out of ${selection.totalCaseCount}`;
}

function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const typedMessage = message as {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (typedMessage.role !== "assistant" || !Array.isArray(typedMessage.content)) {
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

function formatToolOutput(result: unknown): string {
  if (!result || typeof result !== "object") {
    return String(result ?? "");
  }

  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return JSON.stringify(result, null, 2);
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return JSON.stringify(part);
      }
      const typedPart = part as { type?: string; text?: string };
      if (typedPart.type === "text" && typeof typedPart.text === "string") {
        return typedPart.text;
      }
      return JSON.stringify(part, null, 2);
    })
    .join("\n\n")
    .trim();
}

function stringifyForMarkdown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function truncateForMarkdown(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n… [truncated ${text.length - maxLength} chars]`;
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
  anthropicApiKeyPromise ??= (async () => {
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
  })();

  return anthropicApiKeyPromise;
}

async function prepareRunWorkspace(
  row: WebVoyagerRow,
): Promise<{ runDir: string; prompt: string }> {
  const runDir = resolve(repoRoot, "benchmarks", BENCHMARK_NAME, "runs", getRunName(row));
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
        name: `libretto-benchmark-${slugify(row.id)}`,
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
  const agentDir = join(runDir, ".pi-agent");
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

  if (!resourceLoader.getSkills().skills.some((skill) => skill.name === "libretto")) {
    throw new Error("Failed to load the local libretto skill into the benchmark workspace.");
  }

  const model = modelRegistry.find(BENCHMARK_MODEL_PROVIDER, BENCHMARK_MODEL_ID);
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

  const transcriptEntries: string[] = [];
  const transcriptLog: unknown[] = [
    {
      ts: startedAt.toISOString(),
      type: "user_prompt",
      text: prompt,
    },
  ];
  const pendingToolStarts = new Map<string, ToolStartRecord>();
  let finalMessage: string | null = null;
  let thrownError: unknown;

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
      case "message_update": {
        if (event.assistantMessageEvent.type === "text_delta") {
          process.stdout.write(event.assistantMessageEvent.delta);
        }
        break;
      }
      case "message_end": {
        const messageText = extractAssistantText(event.message);
        if (!messageText) {
          break;
        }

        finalMessage = messageText;
        transcriptEntries.push(`Assistant:\n${messageText}`);
        transcriptLog.push(event);
        process.stdout.write("\n");
        break;
      }
      case "tool_execution_start": {
        transcriptLog.push(event);
        pendingToolStarts.set(event.toolCallId, {
          toolName: event.toolName,
          args: event.args,
        });
        break;
      }
      case "tool_execution_end": {
        const start = pendingToolStarts.get(event.toolCallId);
        const toolName = start?.toolName ?? event.toolName;
        const output = formatToolOutput(event.result);
        const markdownArgs =
          typeof start?.args === "undefined"
            ? ""
            : truncateForMarkdown(
                stringifyForMarkdown(start.args),
                MARKDOWN_ARGS_LIMIT,
              );
        const markdownOutput = output
          ? truncateForMarkdown(output, MARKDOWN_OUTPUT_LIMIT)
          : "";

        transcriptEntries.push(
          [
            `[${toolName}]`,
            markdownArgs ? `Args:\n${markdownArgs}` : "",
            markdownOutput
              ? `${event.isError ? "Error" : "Output"}:\n${markdownOutput}`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
        transcriptLog.push(event);
        pendingToolStarts.delete(event.toolCallId);
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
  await writeFile(
    join(runDir, "transcript.jsonl"),
    transcriptLog.map((entry) => JSON.stringify(entry)).join("\n") + (transcriptLog.length ? "\n" : ""),
    "utf8",
  );
  await writeFile(
    join(runDir, "transcript.md"),
    [
      "# WebVoyager Benchmark Run",
      "",
      `- Case ID: ${row.id}`,
      `- Website: ${row.web}`,
      `- Status: ${status}`,
      `- Started: ${result.startedAt}`,
      `- Finished: ${result.finishedAt}`,
      `- Duration (ms): ${durationMs}`,
      `- Final Message: ${finalMessage ?? "n/a"}`,
      `- Evaluation: ${evaluation.reason}`,
      ...(errorMessage ? [`- Error: ${errorMessage}`] : []),
      "",
      "## Transcript",
      "",
      transcriptEntries.join("\n\n---\n\n") || "No transcript content recorded.",
    ].join("\n"),
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
    console.log(`[${index + 1}/${selection.rows.length}] ${formatCaseLabel(row)}`);
    const result = await runWebVoyagerCase(row);
    results.push(result);
    console.log(`${result.status === "passed" ? "Passed" : "Failed"} ${row.id}: ${result.evaluationReason}`);
  }

  const failedCount = results.filter((result) => result.status === "failed").length;
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

const webVoyagerRunInput = SimpleCLI.input({
  positionals: [],
  named: {
    offset: SimpleCLI.option(z.coerce.number().int().nonnegative().optional(), {
      help: "Start at this case index for contiguous runs",
    }),
    count: SimpleCLI.option(z.coerce.number().int().positive().optional(), {
      help: "Number of cases to run",
    }),
    seed: SimpleCLI.option(z.coerce.number().int().optional(), {
      help: "Seed for random selection (default: 1)",
    }),
    random: SimpleCLI.flag({
      help: "Select a seeded random sample instead of a contiguous slice",
    }),
  },
})
  .refine(
    (input) => !input.random || input.offset == null,
    "--offset cannot be used with --random.",
  )
  .refine(
    (input) => input.random || input.seed == null,
    "--seed requires --random.",
  );

export const webVoyagerCommands = SimpleCLI.group({
  description: "WebVoyager benchmark commands",
  routes: {
    run: SimpleCLI.command({
      description: "Run WebVoyager benchmark cases",
    })
      .input(webVoyagerRunInput)
      .handle(async ({ input }) =>
        runWebVoyagerBenchmark({
          offset: input.offset,
          count: input.count,
          seed: input.seed,
          random: input.random,
        }),
      ),
  },
});
