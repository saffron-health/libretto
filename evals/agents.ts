import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getEvalArtifactPaths, type EvalMetrics } from "./artifacts.js";
import { getCloudProviderApi } from "../packages/libretto/src/cli/core/providers/index.js";
import {
  EvalResponse,
  PiEvalHarness,
  scoreTranscript,
  type EvalModelSelector,
  type EvalScore,
} from "./harness.js";
import { recordEvalCall } from "./run-recorder.js";

export const EVAL_AGENT_NAMES = [
  "libretto",
  "libretto-cached",
  "browser-use",
] as const;
export type EvalAgentName = (typeof EVAL_AGENT_NAMES)[number];

export type EvalAgent = {
  name: EvalAgentName;
  browserProvider: string;
  send: (prompt: string) => Promise<EvalAgentResponse>;
  dispose: () => void;
};

export type EvalAgentResponse = {
  prompt: string;
  sessionId: string | null;
  transcript: string;
  metrics: EvalMetrics;
  score: (criteria: string[]) => Promise<EvalScore>;
};

type BrowserUseRunnerOutput = {
  task?: unknown;
  model?: unknown;
  error?: unknown;
  use_vision?: unknown;
  step_observations?: unknown;
  conversation_files?: unknown;
  history?: {
    final_result?: unknown;
    is_done?: unknown;
    is_successful?: unknown;
    has_errors?: unknown;
    number_of_steps?: unknown;
    total_duration_seconds?: unknown;
    urls?: unknown;
    action_names?: unknown;
    action_history?: unknown;
    extracted_content?: unknown;
    errors?: unknown;
    usage?: unknown;
    full_history?: unknown;
  } | null;
  usage_summary?: unknown;
};

type BrowserUseProviderSession = {
  sessionId: string;
  cdpEndpoint: string;
  close: () => Promise<void>;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const browserUseRunnerPath = join(here, "browser-use-runner.py");

function isEvalAgentName(value: string): value is EvalAgentName {
  return EVAL_AGENT_NAMES.includes(value as EvalAgentName);
}

export function parseEvalAgentName(value: string): EvalAgentName {
  const normalized = value.trim().toLowerCase();
  if (isEvalAgentName(normalized)) return normalized;
  throw new Error(
    `Invalid eval agent "${value}". Valid agents: ${EVAL_AGENT_NAMES.join(", ")}`,
  );
}

function appendJsonl(path: string | null, record: Record<string, unknown>): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

function appendMarkdown(path: string | null, markdown: string): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, markdown, "utf8");
}

function recordBrowserUseArtifacts(opts: {
  prompt: string;
  output: BrowserUseRunnerOutput;
  startedAt: string;
  finishedAt: string;
  transcript: string;
}): void {
  const paths = getEvalArtifactPaths();
  appendJsonl(paths?.transcript ?? null, {
    timestamp: opts.startedAt,
    source: "agent",
    event: {
      type: "browser_use_run",
      output: opts.output,
    },
  });
  appendMarkdown(
    paths?.transcriptMarkdown ?? null,
    [
      "## Agent turn",
      "",
      `- Started: ${opts.startedAt}`,
      `- Finished: ${opts.finishedAt}`,
      "",
      "### Prompt",
      "",
      "```text",
      opts.prompt.trim(),
      "```",
      "",
      "### Transcript",
      "",
      "```text",
      opts.transcript.trim(),
      "```",
      "",
    ].join("\n"),
  );
}

function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function transcriptFromBrowserUseOutput(output: BrowserUseRunnerOutput): string {
  const history = output.history;
  return [
    `BROWSER_USE_MODEL: ${typeof output.model === "string" ? output.model : "-"}`,
    `USE_VISION: ${String(output.use_vision ?? "")}`,
    `FINAL_RESULT: ${String(history?.final_result ?? "")}`,
    `IS_DONE: ${String(history?.is_done ?? "")}`,
    `IS_SUCCESSFUL: ${String(history?.is_successful ?? "")}`,
    `HAS_ERRORS: ${String(history?.has_errors ?? "")}`,
    `NUMBER_OF_STEPS: ${String(history?.number_of_steps ?? "")}`,
    "",
    "URLS:",
    compactJson(history?.urls ?? []),
    "",
    "ACTION_NAMES:",
    compactJson(history?.action_names ?? []),
    "",
    "ACTION_HISTORY:",
    compactJson(history?.action_history ?? []),
    "",
    "EXTRACTED_CONTENT:",
    compactJson(history?.extracted_content ?? []),
    "",
    "ERRORS:",
    compactJson(history?.errors ?? []),
    "",
    "FULL_HISTORY:",
    compactJson(history?.full_history ?? []),
    "",
    "STEP_OBSERVATIONS:",
    compactJson(output.step_observations ?? []),
    "",
    "CONVERSATION_FILES:",
    compactJson(output.conversation_files ?? []),
    output.error ? `\nERROR: ${String(output.error)}` : "",
  ]
    .join("\n")
    .trim();
}

function numberAtPath(value: unknown, path: string[]): number | null {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object" || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function firstNumber(value: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const match = numberAtPath(value, path);
    if (match != null) return match;
  }
  return null;
}

function firstNumberFromSources(sources: unknown[], paths: string[][]): number | null {
  for (const source of sources) {
    const match = firstNumber(source, paths);
    if (match != null) return match;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function browserUseMetrics(opts: {
  output: BrowserUseRunnerOutput;
  durationMs: number;
  model: string;
  sessionId: string | null;
  error: string | null;
}): EvalMetrics {
  const usageSources = [opts.output.usage_summary, opts.output.history?.usage];
  const inputTokens =
    firstNumberFromSources(usageSources, [["total_input_tokens"], ["input_tokens"]]) ??
    firstNumberFromSources(usageSources, [["prompt_tokens"], ["total_prompt_tokens"]]);
  const outputTokens =
    firstNumberFromSources(usageSources, [["total_output_tokens"], ["output_tokens"]]) ??
    firstNumberFromSources(usageSources, [
      ["completion_tokens"],
      ["total_completion_tokens"],
    ]);
  const cacheReadTokens = firstNumberFromSources(usageSources, [
    ["cache_read_tokens"],
    ["cached_tokens"],
    ["prompt_cached_tokens"],
    ["total_prompt_cached_tokens"],
  ]);
  const cacheWriteTokens = firstNumberFromSources(usageSources, [
    ["cache_write_tokens"],
  ]);
  const totalTokens =
    firstNumberFromSources(usageSources, [["total_tokens"], ["tokens"]]) ??
    (inputTokens == null && outputTokens == null
      ? null
      : (inputTokens ?? 0) + (outputTokens ?? 0));
  const totalCostUsd = firstNumberFromSources(usageSources, [
    ["total_cost"],
    ["total_cost_usd"],
    ["cost"],
    ["cost_usd"],
  ]);
  const actionNames = stringArray(opts.output.history?.action_names);
  const toolCalls: Record<string, number> = {};
  for (const actionName of actionNames) {
    toolCalls[actionName] = (toolCalls[actionName] ?? 0) + 1;
  }
  const failedErrors = Array.isArray(opts.output.history?.errors)
    ? opts.output.history.errors.filter(Boolean).length
    : opts.error
      ? 1
      : 0;

  return {
    durationMs: opts.durationMs,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    totalCostUsd,
    turns: actionNames.length,
    turnsWithUsage:
      totalTokens == null && totalCostUsd == null && cacheReadTokens == null
        ? 0
        : 1,
    toolCalls,
    totalToolCalls: actionNames.length,
    failedToolCalls: failedErrors,
    failedToolCallsByName: failedErrors > 0 ? { browser_use: failedErrors } : {},
    model: opts.model,
    provider: "browser-use",
    responseIds: [],
    stopReasons: [],
    sessionId: opts.sessionId,
    error: opts.error,
    usageTurns:
      totalTokens == null && totalCostUsd == null && cacheReadTokens == null
        ? []
        : [
            {
              timestamp: null,
              model: opts.model,
              provider: "browser-use",
              responseId: null,
              stopReason: null,
              inputTokens,
              outputTokens,
              cacheReadTokens,
              cacheWriteTokens,
              totalTokens,
              costUsd: totalCostUsd,
            },
          ],
  };
}

function modelIdFromSelector(selector: string): string {
  const slash = selector.indexOf("/");
  return slash >= 0 ? selector.slice(slash + 1) : selector;
}

function runPython(args: {
  python: string;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(args.python, args.argv, {
      cwd: args.cwd,
      env: args.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolvePromise({ stdout, stderr, exitCode });
    });
  });
}

export class LibrettoEvalAgent implements EvalAgent {
  readonly name = "libretto" satisfies EvalAgentName;
  readonly browserProvider: string;
  private readonly harness: PiEvalHarness;

  constructor(harness: PiEvalHarness, browserProvider: string) {
    this.harness = harness;
    this.browserProvider = browserProvider;
  }

  async send(prompt: string): Promise<EvalResponse> {
    return await this.harness.send(prompt);
  }

  dispose(): void {
    this.harness.dispose();
  }
}

export class LibrettoCachedEvalAgent implements EvalAgent {
  readonly name = "libretto-cached" satisfies EvalAgentName;
  readonly browserProvider: string;

  constructor(browserProvider: string) {
    this.browserProvider = browserProvider;
  }

  async send(): Promise<EvalAgentResponse> {
    throw new Error(
      "libretto-cached does not use an agent prompt. Run the cached workflow from the eval case instead.",
    );
  }

  dispose(): void {}
}

export class BrowserUseEvalAgent implements EvalAgent {
  readonly name = "browser-use" satisfies EvalAgentName;
  readonly browserProvider: string;
  private readonly cwd: string;
  private readonly modelSelector: EvalModelSelector;

  constructor(opts: { cwd: string; model: string; browserProvider: string }) {
    this.cwd = opts.cwd;
    this.modelSelector = opts.model as EvalModelSelector;
    this.browserProvider = opts.browserProvider;
  }

  private async createProviderSession(): Promise<BrowserUseProviderSession | null> {
    if (this.browserProvider === "local") return null;
    const provider = getCloudProviderApi(this.browserProvider);
    const session = await provider.createSession();
    return {
      sessionId: session.sessionId,
      cdpEndpoint: session.cdpEndpoint,
      close: async () => {
        await provider.closeSession(session.sessionId);
      },
    };
  }

  async send(prompt: string): Promise<EvalAgentResponse> {
    const model = modelIdFromSelector(this.modelSelector);
    const python = process.env.BROWSER_USE_EVAL_PYTHON?.trim() || "python3";
    const maxSteps = process.env.BROWSER_USE_EVAL_MAX_STEPS?.trim() || "40";
    const taskPath = join(this.cwd, "browser-use-task.txt");
    const outputPath = join(this.cwd, "browser-use-result.json");
    await mkdir(this.cwd, { recursive: true });
    await writeFile(taskPath, prompt, "utf8");

    const providerSession = await this.createProviderSession();
    const runnerArgs = [
        browserUseRunnerPath,
        "--task-file",
        taskPath,
        "--output",
        outputPath,
        "--model",
        model,
        "--cwd",
        this.cwd,
        "--max-steps",
        maxSteps,
    ];
    if (providerSession) {
      runnerArgs.push("--cdp-url", providerSession.cdpEndpoint);
    }

    let run: { stdout: string; stderr: string; exitCode: number | null };
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    try {
      run = await runPython({
        python,
        cwd: this.cwd,
        argv: runnerArgs,
        env: process.env,
      });
    } finally {
      await providerSession?.close();
    }
    let output: BrowserUseRunnerOutput;
    try {
      output = JSON.parse(
        await readFile(outputPath, "utf8"),
      ) as BrowserUseRunnerOutput;
    } catch {
      output = {
        model,
        error: run.stderr.trim() || `Browser Use exited with ${run.exitCode}`,
        history: null,
      };
    }
    const error =
      typeof output.error === "string" && output.error.trim().length > 0
        ? output.error
        : run.exitCode === 0
          ? null
          : run.stderr.trim() || `Browser Use exited with ${run.exitCode}`;
    const durationMs = Date.now() - startedMs;
    const transcript = transcriptFromBrowserUseOutput(output);
    const metrics = browserUseMetrics({
      output,
      durationMs,
      model,
      sessionId: providerSession?.sessionId ?? null,
      error,
    });
    recordBrowserUseArtifacts({
      prompt,
      output,
      startedAt,
      finishedAt: new Date(startedMs + durationMs).toISOString(),
      transcript,
    });
    recordEvalCall({
      source: "agent",
      prompt,
      model: `browser-use/${model}`,
      sessionId: providerSession?.sessionId ?? null,
      metrics,
      error,
    });
    if (error) {
      throw new Error(error);
    }

    return {
      prompt,
      sessionId: providerSession?.sessionId ?? null,
      transcript,
      metrics,
      score: async (criteria: string[]) => {
        const score = await scoreTranscript({
          criteria,
          cwd: this.cwd,
          model: this.modelSelector,
        });
        return {
          ...score,
          agent: {
            prompt,
            model: this.modelSelector,
            sessionId: providerSession?.sessionId ?? "",
            metrics,
          },
        };
      },
    };
  }

  dispose(): void {}
}
