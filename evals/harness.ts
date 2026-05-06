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
} from "@mariozechner/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const EvaluationVerdictSchema = z.object({
  success: z.boolean(),
  reason: z.string().trim().min(1),
});
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

const MAX_TRANSCRIPT_CHARS = 20_000;
const DEFAULT_EVAL_MODEL: EvalModelSelector = "openai/gpt-5.5";
const DEFAULT_THINKING_LEVEL = "medium" satisfies NonNullable<
  CreateAgentSessionOptions["thinkingLevel"]
>;
const TRANSCRIPT_EVENT_TYPES = new Set<AgentSessionEvent["type"]>([
  "message_end",
  "tool_execution_start",
  "tool_execution_end",
]);
const PROGRESS_TEXT_CHARS = 240;
const PROGRESS_TOOL_ARGS_CHARS = 180;
const PROGRESS_TOOL_ERROR_CHARS = 360;
const ANSI_BOLD = "\x1b[1m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";

type EvaluationVerdict = z.infer<typeof EvaluationVerdictSchema>;
export type ScoredCriterion = z.infer<typeof ScoredCriterionSchema>;
export type TranscriptScore = z.infer<typeof TranscriptScoreSchema>;
export type EvalModelSelector = `${string}/${string}`;

type PiMessage = AgentSession["messages"][number];
type PiTool = NonNullable<CreateAgentSessionOptions["tools"]>[number];

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
  stopOnFinalResult?: boolean;
};

export type PiEvalHarnessSendOptions = {
  onUpdate?: (response: EvalResponse) => void | Promise<void>;
};

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.max(1, Math.floor(maxChars / 2));
  const tailChars = Math.max(1, maxChars - headChars);
  return [
    text.slice(0, headChars),
    "",
    `[truncated: showing first ${headChars} chars and last ${tailChars} chars of ${text.length}]`,
    "",
    text.slice(-tailChars),
  ].join("\n");
}

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

function transcriptPath(): string | null {
  const path = process.env.LIBRETTO_EVAL_TRANSCRIPT_PATH?.trim();
  return path && path.length > 0 ? path : null;
}

function appendTranscriptRecord(record: Record<string, unknown>): void {
  const path = transcriptPath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  try {
    appendFileSync(
      path,
      `${JSON.stringify(
        { timestamp: new Date().toISOString(), ...record },
        (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
      )}\n`,
      "utf8",
    );
  } catch (error) {
    appendFileSync(
      path,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        source: record.source,
        type: "transcript_write_error",
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
      "utf8",
    );
  }
}

function recordUserPrompt(source: "agent" | "judge", prompt: string): void {
  appendTranscriptRecord({ source, type: "user", prompt });
}

function recordEvent(
  source: "agent" | "judge",
  event: AgentSessionEvent,
): void {
  appendTranscriptRecord({ source, type: "event", event });
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
    tools:
      opts.tools ??
      ["read", "write", "edit", "bash"],
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
}> {
  const session = await createPiEvalSession({
    cwd: opts.cwd,
    model: opts.model,
    tools: [],
  });
  const events: AgentSessionEvent[] = [];
  const unsubscribe = session.subscribe((event) => {
    if (TRANSCRIPT_EVENT_TYPES.has(event.type)) {
      events.push(event);
      recordEvent("judge", event);
    }
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
    recordUserPrompt("judge", opts.prompt);
    await session.prompt(opts.prompt);
    const messages = [...session.messages];
    const errorMessage = extractAssistantError(messages);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    const text = extractLastAssistantText(messages);
    if (!text) {
      throw new Error("Judge failed: no assistant response from Pi session.");
    }
    return { text, events, messages };
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

async function evaluateTranscript(opts: {
  assertion: string;
  transcript: string;
  cwd: string;
  model?: EvalModelSelector;
}): Promise<EvaluationVerdict> {
  const prompt = [
    "Evaluate whether TRANSCRIPT satisfies ASSERTION.",
    "Return only JSON with keys: success (boolean), reason (string).",
    "Be strict and set success=false if evidence is missing.",
    "",
    `ASSERTION:\n${opts.assertion}`,
    "",
    `TRANSCRIPT:\n${clip(opts.transcript, MAX_TRANSCRIPT_CHARS)}`,
  ].join("\n");

  const result = await runPiJudge({
    prompt,
    cwd: opts.cwd,
    model: opts.model,
  });

  const parsed = EvaluationVerdictSchema.safeParse(
    parseJsonObject(result.text),
  );
  if (!parsed.success) {
    throw new Error(
      `Evaluation returned invalid schema output: ${result.text}`,
    );
  }
  return parsed.data;
}

async function scoreTranscript(opts: {
  criteria: string[];
  transcript: string;
  cwd: string;
  model?: EvalModelSelector;
}): Promise<TranscriptScore> {
  const normalizedCriteria = opts.criteria
    .map((criterion) => criterion.trim())
    .filter((criterion) => criterion.length > 0);
  if (normalizedCriteria.length === 0) {
    throw new Error("score() requires at least one non-empty criterion.");
  }

  const prompt = [
    "Score whether TRANSCRIPT satisfies each criterion in CRITERIA.",
    "Return only JSON with key `criteria` where each item is:",
    "{ criterion: <exact criterion string>, pass: <boolean>, reason: <string> }",
    "Use the exact criterion text; do not rewrite criterion names.",
    "Be strict and mark pass=false when evidence is missing.",
    "",
    `CRITERIA:\n${JSON.stringify(normalizedCriteria, null, 2)}`,
    "",
    `TRANSCRIPT:\n${clip(opts.transcript, MAX_TRANSCRIPT_CHARS)}`,
  ].join("\n");

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
  return TranscriptScoreSchema.parse({
    criteria,
    passed,
    total,
    percent,
  });
}

export class EvalResponse {
  readonly prompt: string;
  readonly messages: PiMessage[];
  readonly events: AgentSessionEvent[];
  readonly sessionId: string;
  readonly transcript: string;
  readonly totalCostUsd: number | null;
  readonly usage: PiUsageSummary;
  private readonly cwd: string;
  private readonly model?: EvalModelSelector;

  constructor(opts: {
    prompt: string;
    messages: PiMessage[];
    events: AgentSessionEvent[];
    sessionId: string;
    cwd: string;
    model?: EvalModelSelector;
  }) {
    this.prompt = opts.prompt;
    this.messages = opts.messages;
    this.events = opts.events;
    this.sessionId = opts.sessionId;
    this.transcript = formatMessagesForEvaluation(opts.messages);
    this.usage = summarizeUsageFromEvents(opts.events);
    this.totalCostUsd = this.usage.totalCostUsd;
    this.cwd = opts.cwd;
    this.model = opts.model;
  }

  async evaluate(assertion: string): Promise<EvaluationVerdict> {
    const verdict = await evaluateTranscript({
      assertion,
      transcript: this.transcript,
      cwd: this.cwd,
      model: this.model,
    });
    if (!verdict.success) {
      throw new Error(verdict.reason);
    }
    return verdict;
  }

  async score(criteria: string[]): Promise<TranscriptScore> {
    return await scoreTranscript({
      criteria,
      transcript: this.transcript,
      cwd: this.cwd,
      model: this.model,
    });
  }
}

export class PiEvalHarness {
  private readonly cwd: string;
  private readonly model?: EvalModelSelector;
  private readonly stopOnFinalResult: boolean;
  private session: AgentSession | null = null;

  constructor(options: PiEvalHarnessOptions) {
    this.cwd = options.cwd;
    this.model = options.model
      ? parseModelSelector(options.model)
      : DEFAULT_EVAL_MODEL;
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
      if (TRANSCRIPT_EVENT_TYPES.has(event.type)) {
        events.push(event);
        recordEvent("agent", event);
      }
      if (event.type === "tool_execution_start") {
        logProgress(formatToolProgress(event.toolName, event.args));
      } else if (event.type === "tool_execution_end" && event.isError) {
        logProgress(formatToolErrorProgress(event.toolName, event.result));
      } else if (event.type === "message_end") {
        logAssistantProgress(event.message);
      }
    });

    try {
      logUserProgress(prompt);
      recordUserPrompt("agent", prompt);
      const update = async () => {
        if (!sendOptions.onUpdate || !this.session) return;
        await sendOptions.onUpdate(
          new EvalResponse({
            prompt,
            messages: [...this.session.messages],
            events: [...events],
            sessionId: this.session.sessionId,
            cwd: this.cwd,
            model: this.model,
          }),
        );
      };

      const progressUnsubscribe = this.session.subscribe((event) => {
        if (this.stopOnFinalResult && event.type === "message_end") {
          const response = new EvalResponse({
            prompt,
            messages: [...this.session!.messages],
            events: [...events],
            sessionId: this.session!.sessionId,
            cwd: this.cwd,
            model: this.model,
          });
          if (extractFinalResultLine(response.transcript) !== null) {
            void this.session!.abort().catch(() => {});
          }
        }
        void update();
      });

      try {
        await this.session.prompt(prompt);
      } finally {
        progressUnsubscribe();
      }

      const messages = [...this.session.messages];
      const errorMessage = extractAssistantError(messages);
      if (errorMessage) {
        throw new Error(errorMessage);
      }

      return new EvalResponse({
        prompt,
        messages,
        events,
        sessionId: this.session.sessionId,
        cwd: this.cwd,
        model: this.model,
      });
    } finally {
      unsubscribe();
    }
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }
}
