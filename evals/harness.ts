import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  query,
  type Options,
  type PermissionMode,
  type NonNullableUsage,
  type ModelUsage,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKResultMessage,
  type SettingSource,
} from "@anthropic-ai/claude-agent-sdk";
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

const EVAL_GCP_PROJECT = "saffron-health";
const ANTHROPIC_API_KEY_SECRET_NAME = "anthropic-api-key";

let didAttemptSecretLoad = false;

const MAX_TRANSCRIPT_CHARS = 20_000;
const MAX_TOOL_RESULT_CHARS = 4_000;

type EvaluationVerdict = z.infer<typeof EvaluationVerdictSchema>;
export type ScoredCriterion = z.infer<typeof ScoredCriterionSchema>;
export type TranscriptScore = z.infer<typeof TranscriptScoreSchema>;

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

function asJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getSecret(secretName: string): string {
  const result = spawnSync(
    "gcloud",
    [
      "secrets",
      "versions",
      "access",
      "latest",
      `--project=${EVAL_GCP_PROJECT}`,
      `--secret=${secretName}`,
    ],
    { encoding: "utf8" },
  );
  if (result.status === 0 && result.stdout.trim().length > 0) {
    return result.stdout.trim();
  }
  return "";
}

function ensureClaudeAuthEnvFromSecretIfNeeded(): void {
  if (didAttemptSecretLoad) return;
  didAttemptSecretLoad = true;

  if (typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.trim().length > 0) {
    return;
  }

  const value = getSecret(ANTHROPIC_API_KEY_SECRET_NAME);
  if (value) {
    process.env.ANTHROPIC_API_KEY = value;
  }
}

function hasAnthropicApiKey(): boolean {
  const value = process.env.ANTHROPIC_API_KEY;
  return typeof value === "string" && value.trim().length > 0;
}

function extractSessionId(messages: SDKMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (
      candidate &&
      typeof candidate === "object" &&
      "session_id" in candidate &&
      typeof candidate.session_id === "string" &&
      candidate.session_id.length > 0
    ) {
      return candidate.session_id;
    }
  }
  return null;
}

function extractResultMessage(messages: SDKMessage[]): SDKResultMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (candidate.type === "result") {
      return candidate;
    }
  }
  return null;
}

function extractAssistantText(message: SDKAssistantMessage): string {
  const content = message.message.content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typedBlock = block as Record<string, unknown>;
    if (typedBlock.type === "text" && typeof typedBlock.text === "string") {
      parts.push(typedBlock.text);
      continue;
    }
    if (typedBlock.type === "tool_use") {
      const name =
        typeof typedBlock.name === "string" && typedBlock.name.length > 0
          ? typedBlock.name
          : "unknown_tool";
      parts.push(`[tool_use:${name}] ${asJson(typedBlock.input)}`);
    }
  }
  return parts.join("\n").trim();
}

function extractUserToolResultText(message: SDKMessage): string {
  if (message.type !== "user") return "";
  const content = message.message.content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typedBlock = block as Record<string, unknown>;
    if (typedBlock.type !== "tool_result") continue;

    const contentValue = typedBlock.content;
    if (typeof contentValue === "string" && contentValue.trim().length > 0) {
      parts.push(clip(contentValue.trim(), MAX_TOOL_RESULT_CHARS));
      continue;
    }

    if (Array.isArray(contentValue)) {
      for (const item of contentValue) {
        if (!item || typeof item !== "object") continue;
        const typedItem = item as Record<string, unknown>;
        if (typedItem.type === "text" && typeof typedItem.text === "string") {
          parts.push(clip(typedItem.text.trim(), MAX_TOOL_RESULT_CHARS));
        }
      }
    }
  }

  return parts.filter(Boolean).join("\n").trim();
}

function formatMessagesForEvaluation(messages: SDKMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    switch (message.type) {
      case "assistant": {
        const assistantText = extractAssistantText(message);
        if (assistantText) {
          lines.push(`assistant:\n${assistantText}`);
        }
        break;
      }
      case "user": {
        const toolResultText = extractUserToolResultText(message);
        if (toolResultText) {
          lines.push(`tool_result:\n${toolResultText}`);
        }
        break;
      }
      case "tool_use_summary": {
        lines.push(`tool_use_summary:\n${message.summary}`);
        break;
      }
      case "result": {
        if (message.subtype === "success") {
          lines.push(`result:\n${message.result}`);
        } else {
          lines.push(`result_error:\n${message.errors.join("\n")}`);
        }
        break;
      }
      default:
        break;
    }
  }
  return lines.join("\n\n").trim();
}

async function evaluateTranscript(opts: {
  assertion: string;
  transcript: string;
  cwd: string;
  model?: string;
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

  const messages: SDKMessage[] = [];
  for await (const message of query({
    prompt,
    options: {
      cwd: opts.cwd,
      model: opts.model,
      tools: [],
      maxTurns: 1,
      persistSession: false,
      permissionMode: "dontAsk",
    },
  })) {
    messages.push(message);
  }

  const result = extractResultMessage(messages);
  if (!result) {
    throw new Error("Evaluation failed: no result message from SDK.");
  }
  if (result.subtype !== "success") {
    const details = result.errors.filter((err) => err.trim().length > 0).join("\n");
    throw new Error(
      [
        `Evaluation failed with subtype "${result.subtype}".`,
        details || "No error details were provided by the SDK.",
      ].join("\n"),
    );
  }

  try {
    const raw = result.result.trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const candidate = start >= 0 && end >= start ? raw.slice(start, end + 1) : raw;
    const parsed = JSON.parse(candidate);
    const fallback = EvaluationVerdictSchema.safeParse(parsed);
    if (fallback.success) {
      return fallback.data;
    }
  } catch {
    // Fall through to explicit error.
  }

  throw new Error(`Evaluation returned invalid schema output: ${result.result}`);
}

async function scoreTranscript(opts: {
  criteria: string[];
  transcript: string;
  cwd: string;
  model?: string;
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

  const messages: SDKMessage[] = [];
  for await (const message of query({
    prompt,
    options: {
      cwd: opts.cwd,
      model: opts.model,
      tools: [],
      maxTurns: 1,
      persistSession: false,
      permissionMode: "dontAsk",
    },
  })) {
    messages.push(message);
  }

  const result = extractResultMessage(messages);
  if (!result) {
    throw new Error("Scoring failed: no result message from SDK.");
  }
  if (result.subtype !== "success") {
    const details = result.errors.filter((err) => err.trim().length > 0).join("\n");
    throw new Error(
      [
        `Scoring failed with subtype "${result.subtype}".`,
        details || "No error details were provided by the SDK.",
      ].join("\n"),
    );
  }

  let parsedCriteria: ScoredCriterion[] | null = null;
  try {
    const raw = result.result.trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const candidate = start >= 0 && end >= start ? raw.slice(start, end + 1) : raw;
    const parsed = JSON.parse(candidate) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "criteria" in parsed &&
      Array.isArray((parsed as { criteria?: unknown }).criteria)
    ) {
      const schema = z.array(ScoredCriterionSchema);
      const parsedArray = schema.safeParse((parsed as { criteria: unknown }).criteria);
      if (parsedArray.success) {
        parsedCriteria = parsedArray.data;
      }
    }
  } catch {
    parsedCriteria = null;
  }

  if (!parsedCriteria) {
    throw new Error(`Scoring returned invalid schema output: ${result.result}`);
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

export function ensureClaudeAuthConfigured(): void {
  ensureClaudeAuthEnvFromSecretIfNeeded();
  if (hasAnthropicApiKey()) return;
  throw new Error(
    [
      "Claude eval configuration missing.",
      `Expected to load ANTHROPIC_API_KEY from gcloud secret "${ANTHROPIC_API_KEY_SECRET_NAME}" in project "${EVAL_GCP_PROJECT}", or have ANTHROPIC_API_KEY already set.`,
      "Ensure gcloud is installed/authenticated and the secret exists with at least one enabled version.",
    ].join("\n"),
  );
}

export type ClaudeEvalHarnessOptions = {
  cwd: string;
  systemPromptAppend?: string;
  model?: string;
  maxTurns?: number;
  permissionMode?: PermissionMode;
  settingSources?: SettingSource[];
  allowedTools?: string[];
  stopOnFinalResult?: boolean;
};

export type ClaudeEvalHarnessSendOptions = {
  onUpdate?: (response: EvalResponse) => void | Promise<void>;
};

export class EvalResponse {
  readonly prompt: string;
  readonly messages: SDKMessage[];
  readonly sessionId: string | null;
  readonly transcript: string;
  readonly result: SDKResultMessage | null;
  readonly totalCostUsd: number | null;
  readonly usage: NonNullableUsage | null;
  readonly modelUsage: Record<string, ModelUsage> | null;
  private readonly cwd: string;
  private readonly model?: string;

  constructor(opts: {
    prompt: string;
    messages: SDKMessage[];
    sessionId: string | null;
    cwd: string;
    model?: string;
  }) {
    this.prompt = opts.prompt;
    this.messages = opts.messages;
    this.sessionId = opts.sessionId;
    this.transcript = formatMessagesForEvaluation(opts.messages);
    this.result = extractResultMessage(opts.messages);
    this.totalCostUsd =
      this.result && typeof this.result.total_cost_usd === "number"
        ? this.result.total_cost_usd
        : null;
    this.usage = this.result?.usage ?? null;
    this.modelUsage = this.result?.modelUsage ?? null;
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

export class ClaudeEvalHarness {
  private readonly cwd: string;
  private readonly model?: string;
  private readonly maxTurns: number;
  private readonly permissionMode: PermissionMode;
  private readonly settingSources: SettingSource[];
  private readonly systemPromptAppend: string | null;
  private readonly allowedTools: string[];
  private readonly stopOnFinalResult: boolean;
  private sessionId: string;
  private hasStarted = false;

  constructor(options: ClaudeEvalHarnessOptions) {
    this.cwd = options.cwd;
    this.model = options.model;
    this.maxTurns = options.maxTurns ?? 20;
    this.permissionMode = options.permissionMode ?? "bypassPermissions";
    this.settingSources = options.settingSources ?? ["project"];
    this.allowedTools = options.allowedTools ?? [];
    this.systemPromptAppend = options.systemPromptAppend?.trim() || null;
    this.stopOnFinalResult = options.stopOnFinalResult === true;

    this.sessionId = randomUUID();
  }

  async send(
    prompt: string,
    sendOptions: ClaudeEvalHarnessSendOptions = {},
  ): Promise<EvalResponse> {
    const options: Options = {
      cwd: this.cwd,
      model: this.model,
      maxTurns: this.maxTurns,
      tools: { type: "preset", preset: "claude_code" },
      settingSources: this.settingSources,
      permissionMode: this.permissionMode,
      allowedTools: this.allowedTools,
    };

    if (this.systemPromptAppend) {
      options.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: this.systemPromptAppend,
      };
    }

    if (this.permissionMode === "bypassPermissions") {
      options.allowDangerouslySkipPermissions = true;
    }

    if (this.hasStarted) {
      options.resume = this.sessionId;
    } else {
      options.sessionId = this.sessionId;
    }

    const messages: SDKMessage[] = [];
    for await (const message of query({ prompt, options })) {
      messages.push(message);

      const seenSessionId = extractSessionId(messages);
      if (seenSessionId) {
        this.sessionId = seenSessionId;
        this.hasStarted = true;
      }

      if (sendOptions.onUpdate) {
        await sendOptions.onUpdate(
          new EvalResponse({
            prompt,
            messages: [...messages],
            sessionId: seenSessionId ?? this.sessionId,
            cwd: this.cwd,
            model: this.model,
          }),
        );
      }

      if (
        this.stopOnFinalResult &&
        message.type === "result" &&
        message.subtype === "success" &&
        extractFinalResultLine(message.result) !== null
      ) {
        break;
      }
    }

    const seenSessionId = extractSessionId(messages);
    if (seenSessionId) {
      this.sessionId = seenSessionId;
      this.hasStarted = true;
    }

    const response = new EvalResponse({
      prompt,
      messages,
      sessionId: seenSessionId ?? this.sessionId,
      cwd: this.cwd,
      model: this.model,
    });
    return response;
  }
}
