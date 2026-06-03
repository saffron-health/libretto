import {
  AuthStorage,
  convertToLlm,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  serializeConversation,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  getEvalArtifactPaths,
  metricsFromEvents,
  type EvalMetrics,
} from "./artifacts.js";
import { recordEvalCall } from "./run-recorder.js";

const ScoredCriterionSchema = z.object({
  criterion: z.string().trim().min(1),
  pass: z.boolean(),
  reason: z.string().trim().min(1),
});
const TranscriptScoreSchema = z.object({
  criteria: z.array(ScoredCriterionSchema).min(1),
  passed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  percent: z.number().min(0).max(100),
});

const DEFAULT_EVAL_MODEL: EvalModelSelector = "openai/gpt-5.5";
const DEFAULT_THINKING_LEVEL = "medium" satisfies NonNullable<
  CreateAgentSessionOptions["thinkingLevel"]
>;
const PROGRESS_TEXT_CHARS = 240;
const PROGRESS_TOOL_ARGS_CHARS = 180;
const PROGRESS_TOOL_ERROR_CHARS = 360;
const ANSI_BOLD = "\x1b[1m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";

export type ScoredCriterion = z.infer<typeof ScoredCriterionSchema>;
export type EvalModelSelector = `${string}/${string}`;

export type EvalJudgeRecord = {
  prompt: string;
  model: EvalModelSelector;
  sessionId: string;
  result: string;
  rationale: string | null;
  metrics: EvalMetrics;
};

export type EvalScore = z.infer<typeof TranscriptScoreSchema> & {
  agent: {
    prompt: string;
    model: EvalModelSelector;
    sessionId: string;
    metrics: EvalMetrics;
  };
  judge: EvalJudgeRecord;
};

type PiMessage = AgentSession["messages"][number];
type PiTool = NonNullable<CreateAgentSessionOptions["tools"]>[number];
type PiCustomTool = NonNullable<CreateAgentSessionOptions["customTools"]>[number];

const CAPTCHA_WAIT_MS = 60_000;
const EMPTY_TOOL_PARAMETERS = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as unknown as ToolDefinition["parameters"];

const solveCaptchaTool: ToolDefinition = {
  name: "solve_captcha",
  label: "solve_captcha",
  description:
    "Wait up to 1 minute for the configured hosted browser provider to automatically solve a CAPTCHA, bot check, or anti-bot challenge.",
  promptSnippet:
    "solve_captcha: wait up to 1 minute for the hosted browser provider to automatically solve a CAPTCHA, bot check, or anti-bot challenge.",
  promptGuidelines: [
    "If a browser task hits a CAPTCHA, bot check, access-denied page, or similar anti-bot challenge, call solve_captcha once and then inspect the same page again.",
  ],
  parameters: EMPTY_TOOL_PARAMETERS,
  async execute(_toolCallId, _params, signal) {
    const startedMs = Date.now();
    await sleep(CAPTCHA_WAIT_MS, signal);
    const waitedMs = Date.now() - startedMs;
    return {
      content: [
        {
          type: "text",
          text: `Waited ${Math.round(waitedMs / 1000)} seconds for CAPTCHA auto-solving. Check the page again before deciding whether the task is blocked.`,
        },
      ],
      details: { waitedMs },
    };
  },
};

type PiUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCostUsd: number | null;
};

export type PiEvalHarnessOptions = {
  cwd: string;
  model?: string;
  browserProvider?: string | null;
  stopOnFinalResult?: boolean;
};

export type PiEvalHarnessSendOptions = {
  onUpdate?: (response: EvalResponse) => void | Promise<void>;
};

function extractFinalResultLine(transcript: string): string | null {
  const finalResultLine = transcript
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("FINAL_RESULT:"));
  return finalResultLine ?? null;
}

function compactText(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringifyForProgress(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!isRecord(block)) return [];
      if (block.type === "text" && typeof block.text === "string") {
        return [block.text];
      }
      if (block.type === "image") return ["[image]"];
      return [];
    })
    .join("\n");
}

function assistantMessageText(message: PiMessage): string {
  if (messageRole(message) !== "assistant") return "";
  return contentText((message as { content?: unknown }).content);
}

function logProgress(line: string): void {
  process.stdout.write(`${line}\n`);
}

function red(text: string): string {
  return `${ANSI_RED}${text}${ANSI_RESET}`;
}

function bold(text: string): string {
  return `${ANSI_BOLD}${text}${ANSI_RESET}`;
}

function logUserProgress(prompt: string): void {
  logProgress(`user: ${compactText(prompt, PROGRESS_TEXT_CHARS)}`);
}

function logAssistantProgress(message: PiMessage): void {
  const text = compactText(assistantMessageText(message), PROGRESS_TEXT_CHARS);
  if (text.length > 0) {
    logProgress(text);
  }
}

function progressArg(args: unknown, keys: string[]): string | null {
  if (!isRecord(args)) return null;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function formatToolProgress(toolName: string, args: unknown): string {
  const focusedArg =
    progressArg(args, ["command", "path", "filePath"]) ??
    stringifyForProgress(args);
  const compactArgs = compactText(focusedArg, PROGRESS_TOOL_ARGS_CHARS);
  const label = bold(toolName);
  return compactArgs ? `-> ${label} ${compactArgs}` : `-> ${label}`;
}

function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return stringifyForProgress(result);

  const content = contentText(result.content);
  if (content) return content;

  const fields = ["error", "message", "stderr", "stdout"];
  for (const field of fields) {
    const value = result[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return stringifyForProgress(result);
}

function formatToolErrorProgress(toolName: string, result: unknown): string {
  const errorText = compactText(
    toolResultText(result),
    PROGRESS_TOOL_ERROR_CHARS,
  );
  return red(
    errorText
      ? `-> ${bold(toolName)} error: ${errorText}`
      : `-> ${bold(toolName)} error`,
  );
}

function appendJsonl(
  path: string | null,
  record: Record<string, unknown>,
): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(
    path,
    `${JSON.stringify(
      { timestamp: new Date().toISOString(), ...record },
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
    )}\n`,
    "utf8",
  );
}

function appendMarkdown(path: string | null, markdown: string): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, markdown, "utf8");
}

function recordRawEvent(
  source: "agent" | "judge",
  event: AgentSessionEvent,
): void {
  const paths = getEvalArtifactPaths();
  appendJsonl(
    source === "agent"
      ? (paths?.transcript ?? null)
      : (paths?.judgeEvents ?? null),
    { source, event },
  );
}

function recordTranscriptMarkdown(opts: {
  source: "agent" | "judge";
  prompt: string;
  transcript: string;
  startedAt: string;
  finishedAt: string;
}): void {
  const paths = getEvalArtifactPaths();
  appendMarkdown(
    opts.source === "agent"
      ? (paths?.transcriptMarkdown ?? null)
      : (paths?.judgeTranscript ?? null),
    [
      `## ${opts.source === "agent" ? "Agent" : "Judge"} turn`,
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

function parseModelSelector(selector: string): EvalModelSelector {
  const trimmed = selector.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new Error(
      `Invalid eval model "${selector}". Expected "provider/model-id".`,
    );
  }
  return trimmed as EvalModelSelector;
}

function resolvePiModel(
  modelRegistry: ModelRegistry,
  selector: EvalModelSelector,
): NonNullable<ReturnType<ModelRegistry["find"]>> {
  const slash = selector.indexOf("/");
  const provider = selector.slice(0, slash);
  const modelId = selector.slice(slash + 1);
  const model = modelRegistry.find(provider, modelId);
  if (!model) {
    throw new Error(`Unknown Pi model: ${selector}`);
  }
  return model;
}

async function createPiEvalSession(opts: {
  cwd: string;
  model?: EvalModelSelector;
  tools?: PiTool[];
  customTools?: PiCustomTool[];
}): Promise<AgentSession> {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = resolvePiModel(modelRegistry, opts.model ?? DEFAULT_EVAL_MODEL);
  const agentDir = join(opts.cwd, ".pi");
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: opts.cwd,
    agentDir,
    model,
    thinkingLevel: DEFAULT_THINKING_LEVEL,
    authStorage,
    modelRegistry,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(opts.cwd),
    tools: opts.tools ?? ["read", "write", "edit", "bash", "solve_captcha"],
    customTools: opts.customTools ?? (opts.tools ? [] : [solveCaptchaTool]),
  });
  return session;
}

function messageRole(message: PiMessage): string | undefined {
  return message && typeof message === "object" && "role" in message
    ? message.role
    : undefined;
}

function formatMessagesForEvaluation(messages: PiMessage[]): string {
  return serializeConversation(convertToLlm(messages)).trim();
}

function extractLastAssistantText(messages: PiMessage[]): string | null {
  const llmMessages = convertToLlm(messages);
  for (let i = llmMessages.length - 1; i >= 0; i -= 1) {
    const message = llmMessages[i];
    if (message.role !== "assistant") continue;
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return null;
}

function extractAssistantError(messages: PiMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (messageRole(message) !== "assistant") continue;
    const errorMessage = (message as { errorMessage?: unknown }).errorMessage;
    if (typeof errorMessage === "string" && errorMessage.trim().length > 0) {
      return errorMessage.trim();
    }
  }
  return null;
}

function summarizeUsageFromEvents(events: AgentSessionEvent[]): PiUsageSummary {
  const summary: PiUsageSummary = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCostUsd: null,
  };

  for (const event of events) {
    if (event.type !== "message_end") continue;
    const message = event.message;
    if (messageRole(message) !== "assistant") continue;
    const usage = (
      message as {
        usage?: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
          totalTokens?: number;
          cost?: { total?: number };
        };
      }
    ).usage;
    if (!usage) continue;

    summary.inputTokens += usage.input ?? 0;
    summary.outputTokens += usage.output ?? 0;
    summary.cacheReadTokens += usage.cacheRead ?? 0;
    summary.cacheWriteTokens += usage.cacheWrite ?? 0;
    summary.totalTokens += usage.totalTokens ?? 0;
    if (
      typeof usage.cost?.total === "number" &&
      Number.isFinite(usage.cost.total)
    ) {
      summary.totalCostUsd = (summary.totalCostUsd ?? 0) + usage.cost.total;
    }
  }

  return summary;
}

async function runPiJudge(opts: {
  prompt: string;
  cwd: string;
  model?: EvalModelSelector;
}): Promise<{
  text: string;
  events: AgentSessionEvent[];
  messages: PiMessage[];
  sessionId: string;
  durationMs: number;
}> {
  const session = await createPiEvalSession({
    cwd: opts.cwd,
    model: opts.model,
    tools: ["read", "bash"],
  });
  const events: AgentSessionEvent[] = [];
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  let callRecorded = false;
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
    recordRawEvent("judge", event);
    if (event.type === "tool_execution_start") {
      logProgress(formatToolProgress(event.toolName, event.args));
    } else if (event.type === "tool_execution_end" && event.isError) {
      logProgress(formatToolErrorProgress(event.toolName, event.result));
    } else if (event.type === "message_end") {
      logAssistantProgress(event.message);
    }
  });

  try {
    logUserProgress(opts.prompt);
    await session.prompt(opts.prompt);
    const finishedMs = Date.now();
    const messages = [...session.messages];
    const errorMessage = extractAssistantError(messages);
    if (errorMessage) {
      recordEvalCall({
        source: "judge",
        prompt: opts.prompt,
        model: opts.model ?? DEFAULT_EVAL_MODEL,
        sessionId: session.sessionId,
        metrics: metricsFromEvents({
          events,
          durationMs: finishedMs - startedMs,
          sessionId: session.sessionId,
          modelSelector: opts.model ?? DEFAULT_EVAL_MODEL,
          error: errorMessage,
        }),
        error: errorMessage,
      });
      callRecorded = true;
      throw new Error(errorMessage);
    }
    const text = extractLastAssistantText(messages);
    if (!text) {
      const error = "Judge failed: no assistant response from Pi session.";
      recordEvalCall({
        source: "judge",
        prompt: opts.prompt,
        model: opts.model ?? DEFAULT_EVAL_MODEL,
        sessionId: session.sessionId,
        metrics: metricsFromEvents({
          events,
          durationMs: finishedMs - startedMs,
          sessionId: session.sessionId,
          modelSelector: opts.model ?? DEFAULT_EVAL_MODEL,
          error,
        }),
        error,
      });
      callRecorded = true;
      throw new Error("Judge failed: no assistant response from Pi session.");
    }
    recordTranscriptMarkdown({
      source: "judge",
      prompt: opts.prompt,
      transcript: formatMessagesForEvaluation(messages),
      startedAt,
      finishedAt: new Date(finishedMs).toISOString(),
    });
    recordEvalCall({
      source: "judge",
      prompt: opts.prompt,
      model: opts.model ?? DEFAULT_EVAL_MODEL,
      sessionId: session.sessionId,
      metrics: metricsFromEvents({
        events,
        durationMs: finishedMs - startedMs,
        sessionId: session.sessionId,
        modelSelector: opts.model ?? DEFAULT_EVAL_MODEL,
      }),
      error: null,
    });
    callRecorded = true;
    return {
      text,
      events,
      messages,
      sessionId: session.sessionId,
      durationMs: finishedMs - startedMs,
    };
  } catch (error) {
    if (!callRecorded) {
      const message = error instanceof Error ? error.message : String(error);
      recordEvalCall({
        source: "judge",
        prompt: opts.prompt,
        model: opts.model ?? DEFAULT_EVAL_MODEL,
        sessionId: session.sessionId,
        metrics: metricsFromEvents({
          events,
          durationMs: Date.now() - startedMs,
          sessionId: session.sessionId,
          modelSelector: opts.model ?? DEFAULT_EVAL_MODEL,
          error: message,
        }),
        error: message,
      });
    }
    throw error;
  } finally {
    unsubscribe();
    session.dispose();
  }
}

function parseJsonObject(text: string): unknown {
  const raw = text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate =
    start >= 0 && end >= start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(candidate) as unknown;
}

export async function scoreTranscript(opts: {
  criteria: string[];
  cwd: string;
  model?: EvalModelSelector;
}): Promise<z.infer<typeof TranscriptScoreSchema> & { judge: EvalJudgeRecord }> {
  const normalizedCriteria = opts.criteria
    .map((criterion) => criterion.trim())
    .filter((criterion) => criterion.length > 0);
  if (normalizedCriteria.length === 0) {
    throw new Error("score() requires at least one non-empty criterion.");
  }

  const artifactPaths = getEvalArtifactPaths();
  const caseDir = artifactPaths ? dirname(artifactPaths.transcript) : null;

  const prompt = caseDir
    ? [
        "Score whether the eval run artifacts satisfy each criterion in CRITERIA.",
        "Use the read and bash tools to inspect files in CASE_DIR.",
        "Prioritize CASE_DIR/transcript.jsonl, which is the raw agent event stream and includes full tool call arguments.",
        "Use jq with bash to query transcript.jsonl when you need structured evidence from tool calls or events.",
        "Use CASE_DIR/transcript.md as a human-readable secondary view.",
        "Return only JSON with key `criteria` where each item is:",
        "{ criterion: <exact criterion string>, pass: <boolean>, reason: <string> }",
        "Use the exact criterion text; do not rewrite criterion names.",
        "Be strict and mark pass=false when evidence is missing from the artifacts.",
        "",
        `CASE_DIR:
${caseDir}`,
        "",
        `CRITERIA:
${JSON.stringify(normalizedCriteria, null, 2)}`,
      ].join("\n")
    : (() => {
        throw new Error("score() requires eval artifact paths.");
      })();

  const result = await runPiJudge({
    prompt,
    cwd: opts.cwd,
    model: opts.model,
  });

  let parsedCriteria: ScoredCriterion[] | null = null;
  try {
    const parsed = parseJsonObject(result.text);
    if (
      parsed &&
      typeof parsed === "object" &&
      "criteria" in parsed &&
      Array.isArray((parsed as { criteria?: unknown }).criteria)
    ) {
      const schema = z.array(ScoredCriterionSchema);
      const parsedArray = schema.safeParse(
        (parsed as { criteria: unknown }).criteria,
      );
      if (parsedArray.success) {
        parsedCriteria = parsedArray.data;
      }
    }
  } catch {
    parsedCriteria = null;
  }

  if (!parsedCriteria) {
    throw new Error(`Scoring returned invalid schema output: ${result.text}`);
  }

  const byCriterion = new Map<string, ScoredCriterion>();
  for (const item of parsedCriteria) {
    if (!byCriterion.has(item.criterion)) {
      byCriterion.set(item.criterion, item);
    }
  }

  const criteria = normalizedCriteria.map((criterion) => {
    const matched = byCriterion.get(criterion);
    if (matched) {
      return {
        criterion,
        pass: matched.pass,
        reason: matched.reason,
      };
    }
    return {
      criterion,
      pass: false,
      reason: "No score returned for this criterion.",
    };
  });

  const total = criteria.length;
  const passed = criteria.filter((criterion) => criterion.pass).length;
  const percent = Math.round((passed / total) * 100);
  const score = TranscriptScoreSchema.parse({
    criteria,
    passed,
    total,
    percent,
  });
  return {
    ...score,
    judge: {
      prompt,
      model: opts.model ?? DEFAULT_EVAL_MODEL,
      sessionId: result.sessionId,
      result: result.text,
      rationale: criteria.map((criterion) => criterion.reason).join("\n"),
      metrics: metricsFromEvents({
        events: result.events,
        durationMs: result.durationMs,
        sessionId: result.sessionId,
        modelSelector: opts.model ?? DEFAULT_EVAL_MODEL,
      }),
    },
  };
}

export class EvalResponse {
  readonly prompt: string;
  readonly messages: PiMessage[];
  readonly events: AgentSessionEvent[];
  readonly sessionId: string;
  readonly transcript: string;
  readonly totalCostUsd: number | null;
  readonly usage: PiUsageSummary;
  readonly metrics: EvalMetrics;
  private readonly cwd: string;
  private readonly model: EvalModelSelector;

  constructor(opts: {
    prompt: string;
    messages: PiMessage[];
    events: AgentSessionEvent[];
    sessionId: string;
    cwd: string;
    model: EvalModelSelector;
    durationMs: number | null;
    error?: string | null;
  }) {
    this.prompt = opts.prompt;
    this.messages = opts.messages;
    this.events = opts.events;
    this.sessionId = opts.sessionId;
    this.transcript = formatMessagesForEvaluation(opts.messages);
    this.usage = summarizeUsageFromEvents(opts.events);
    this.totalCostUsd = this.usage.totalCostUsd;
    this.metrics = metricsFromEvents({
      events: opts.events,
      durationMs: opts.durationMs,
      sessionId: opts.sessionId,
      modelSelector: opts.model,
      error: opts.error,
    });
    this.cwd = opts.cwd;
    this.model = opts.model;
  }

  async score(criteria: string[]): Promise<EvalScore> {
    const score = await scoreTranscript({
      criteria,
      cwd: this.cwd,
      model: this.model,
    });
    return {
      ...score,
      agent: {
        prompt: this.prompt,
        model: this.model,
        sessionId: this.sessionId,
        metrics: this.metrics,
      },
    };
  }
}

export class PiEvalHarness {
  private readonly cwd: string;
  private readonly model: EvalModelSelector;
  readonly browserProvider: string;
  private readonly stopOnFinalResult: boolean;
  private session: AgentSession | null = null;

  constructor(options: PiEvalHarnessOptions) {
    this.cwd = options.cwd;
    this.model = options.model
      ? parseModelSelector(options.model)
      : DEFAULT_EVAL_MODEL;
    this.browserProvider = options.browserProvider ?? "local";
    this.stopOnFinalResult = options.stopOnFinalResult === true;
  }

  async send(
    prompt: string,
    sendOptions: PiEvalHarnessSendOptions = {},
  ): Promise<EvalResponse> {
    this.session ??= await createPiEvalSession({
      cwd: this.cwd,
      model: this.model,
    });

    const events: AgentSessionEvent[] = [];
    const unsubscribe = this.session.subscribe((event) => {
      events.push(event);
      recordRawEvent("agent", event);
      if (event.type === "tool_execution_start") {
        logProgress(formatToolProgress(event.toolName, event.args));
      } else if (event.type === "tool_execution_end" && event.isError) {
        logProgress(formatToolErrorProgress(event.toolName, event.result));
      } else if (event.type === "message_end") {
        logAssistantProgress(event.message);
      }
    });

    try {
      const startedMs = Date.now();
      const startedAt = new Date(startedMs).toISOString();
      let callRecorded = false;
      const buildResponse = (error: string | null = null) => {
        if (!this.session) {
          throw new Error("Eval harness session ended before response recording.");
        }
        return new EvalResponse({
          prompt,
          messages: [...this.session.messages],
          events,
          sessionId: this.session.sessionId,
          cwd: this.cwd,
          model: this.model,
          durationMs: Date.now() - startedMs,
          error,
        });
      };
      const recordAgentCall = (response: EvalResponse, error: string | null) => {
        if (callRecorded) return;
        recordEvalCall({
          source: "agent",
          prompt,
          model: this.model,
          sessionId: response.sessionId,
          metrics: response.metrics,
          error,
        });
        callRecorded = true;
      };
      logUserProgress(prompt);
      const update = async () => {
        if (!sendOptions.onUpdate || !this.session) return;
        await sendOptions.onUpdate(buildResponse());
      };

      const progressUnsubscribe = this.session.subscribe((event) => {
        if (this.stopOnFinalResult && event.type === "message_end") {
          const response = buildResponse();
          if (extractFinalResultLine(response.transcript) !== null) {
            void this.session!.abort().catch(() => {});
          }
        }
        void update();
      });

      try {
        await this.session.prompt(prompt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const response = buildResponse(message);
        recordAgentCall(response, message);
        recordTranscriptMarkdown({
          source: "agent",
          prompt,
          transcript: response.transcript,
          startedAt,
          finishedAt: new Date().toISOString(),
        });
        throw error;
      } finally {
        progressUnsubscribe();
      }

      const finishedMs = Date.now();

      const messages = [...this.session.messages];
      const errorMessage = extractAssistantError(messages);
      if (errorMessage) {
        const response = new EvalResponse({
          prompt,
          messages,
          events,
          sessionId: this.session.sessionId,
          cwd: this.cwd,
          model: this.model,
          durationMs: finishedMs - startedMs,
          error: errorMessage,
        });
        recordAgentCall(response, errorMessage);
        recordTranscriptMarkdown({
          source: "agent",
          prompt,
          transcript: response.transcript,
          startedAt,
          finishedAt: new Date(finishedMs).toISOString(),
        });
        throw new Error(errorMessage);
      }

      const response = new EvalResponse({
        prompt,
        messages,
        events,
        sessionId: this.session.sessionId,
        cwd: this.cwd,
        model: this.model,
        durationMs: finishedMs - startedMs,
      });
      recordAgentCall(response, null);
      recordTranscriptMarkdown({
        source: "agent",
        prompt,
        transcript: response.transcript,
        startedAt,
        finishedAt: new Date(finishedMs).toISOString(),
      });
      return response;
    } finally {
      unsubscribe();
    }
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }
}
