import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export type EvalArtifactPaths = {
  transcript: string;
  transcriptMarkdown: string;
  judgeEvents: string;
  judgeTranscript: string;
};

const artifactPathsStorage = new AsyncLocalStorage<EvalArtifactPaths | null>();

export function getEvalArtifactPaths(): EvalArtifactPaths | null {
  return artifactPathsStorage.getStore() ?? null;
}

export async function withEvalArtifactPaths<T>(
  paths: EvalArtifactPaths,
  fn: () => Promise<T>,
): Promise<T> {
  return await artifactPathsStorage.run(paths, fn);
}

export type EvalUsageTurn = {
  timestamp: string | null;
  model: string | null;
  provider: string | null;
  responseId: string | null;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
};

export type EvalMetrics = {
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  totalCostUsd: number | null;
  turns: number;
  turnsWithUsage: number;
  toolCalls: Record<string, number>;
  totalToolCalls: number;
  failedToolCalls: number;
  failedToolCallsByName: Record<string, number>;
  model: string | null;
  provider: string | null;
  responseIds: string[];
  stopReasons: string[];
  sessionId: string | null;
  error: string | null;
  usageTurns: EvalUsageTurn[];
};

export const EMPTY_EVAL_METRICS: EvalMetrics = {
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  totalTokens: null,
  totalCostUsd: null,
  turns: 0,
  turnsWithUsage: 0,
  toolCalls: {},
  totalToolCalls: 0,
  failedToolCalls: 0,
  failedToolCallsByName: {},
  model: null,
  provider: null,
  responseIds: [],
  stopReasons: [],
  sessionId: null,
  error: null,
  usageTurns: [],
};

type EventWithMessage = AgentSessionEvent & {
  timestamp?: string | number;
  message?: {
    role?: string;
    timestamp?: string | number;
    model?: string;
    provider?: string;
    responseId?: string;
    stopReason?: string;
    usage?: UsageFields;
  };
  model?: string;
  provider?: string;
  responseId?: string;
  stopReason?: string;
  usage?: UsageFields;
};

type UsageFields = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
};

function toOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return null;
}

function addOptional(
  total: number | null,
  value: number | null,
): number | null {
  if (value == null) return total;
  return (total ?? 0) + value;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function usageTurnFromEvent(event: AgentSessionEvent): EvalUsageTurn | null {
  if (event.type !== "message_end") return null;
  const typedEvent = event as EventWithMessage;
  if (typedEvent.message?.role !== "assistant") return null;

  const usage = typedEvent.usage ?? typedEvent.message?.usage;
  return {
    timestamp: formatTimestamp(
      typedEvent.timestamp ?? typedEvent.message.timestamp,
    ),
    model: firstString(typedEvent.model, typedEvent.message.model),
    provider: firstString(typedEvent.provider, typedEvent.message.provider),
    responseId: firstString(
      typedEvent.responseId,
      typedEvent.message.responseId,
    ),
    stopReason: firstString(
      typedEvent.stopReason,
      typedEvent.message.stopReason,
    ),
    inputTokens: toOptionalNumber(usage?.input),
    outputTokens: toOptionalNumber(usage?.output),
    cacheReadTokens: toOptionalNumber(usage?.cacheRead),
    cacheWriteTokens: toOptionalNumber(usage?.cacheWrite),
    totalTokens: toOptionalNumber(usage?.totalTokens),
    costUsd: toOptionalNumber(usage?.cost?.total),
  };
}

function hasUsage(turn: EvalUsageTurn): boolean {
  return (
    turn.inputTokens != null ||
    turn.outputTokens != null ||
    turn.cacheReadTokens != null ||
    turn.cacheWriteTokens != null ||
    turn.totalTokens != null ||
    turn.costUsd != null
  );
}

export function metricsFromEvents(opts: {
  events: AgentSessionEvent[];
  durationMs: number | null;
  sessionId: string | null;
  modelSelector?: string | null;
  error?: string | null;
}): EvalMetrics {
  const toolCalls: Record<string, number> = {};
  const failedToolCallsByName: Record<string, number> = {};
  let totalToolCalls = 0;
  let failedToolCalls = 0;

  for (const event of opts.events) {
    if (event.type === "tool_execution_start") {
      toolCalls[event.toolName] = (toolCalls[event.toolName] ?? 0) + 1;
      totalToolCalls += 1;
    } else if (event.type === "tool_execution_end" && event.isError) {
      failedToolCallsByName[event.toolName] =
        (failedToolCallsByName[event.toolName] ?? 0) + 1;
      failedToolCalls += 1;
    }
  }

  const usageTurns = opts.events.flatMap((event) => {
    const turn = usageTurnFromEvent(event);
    return turn ? [turn] : [];
  });
  const turnsWithUsage = usageTurns.filter(hasUsage);

  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cacheReadTokens: number | null = null;
  let cacheWriteTokens: number | null = null;
  let totalTokens: number | null = null;
  let totalCostUsd: number | null = null;

  for (const turn of usageTurns) {
    inputTokens = addOptional(inputTokens, turn.inputTokens);
    outputTokens = addOptional(outputTokens, turn.outputTokens);
    cacheReadTokens = addOptional(cacheReadTokens, turn.cacheReadTokens);
    cacheWriteTokens = addOptional(cacheWriteTokens, turn.cacheWriteTokens);
    totalTokens = addOptional(totalTokens, turn.totalTokens);
    totalCostUsd = addOptional(totalCostUsd, turn.costUsd);
  }

  const [fallbackProvider, fallbackModel] = opts.modelSelector?.includes("/")
    ? opts.modelSelector.split("/", 2)
    : [null, opts.modelSelector ?? null];
  const firstTurnWithModel = usageTurns.find(
    (turn) => turn.model || turn.provider,
  );
  const responseIds = usageTurns
    .map((turn) => turn.responseId)
    .filter((value): value is string => value != null);
  const stopReasons = usageTurns
    .map((turn) => turn.stopReason)
    .filter((value): value is string => value != null);

  return {
    durationMs: opts.durationMs,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    totalCostUsd,
    turns: usageTurns.length,
    turnsWithUsage: turnsWithUsage.length,
    toolCalls,
    totalToolCalls,
    failedToolCalls,
    failedToolCallsByName,
    model: firstTurnWithModel?.model ?? fallbackModel,
    provider: firstTurnWithModel?.provider ?? fallbackProvider,
    responseIds,
    stopReasons,
    sessionId: opts.sessionId,
    error: opts.error ?? null,
    usageTurns,
  };
}

export function aggregateMetrics(metrics: EvalMetrics[]): EvalMetrics {
  const aggregate: EvalMetrics = {
    ...EMPTY_EVAL_METRICS,
    toolCalls: {},
    failedToolCallsByName: {},
    responseIds: [],
    stopReasons: [],
    usageTurns: [],
  };

  for (const metric of metrics) {
    aggregate.durationMs = addOptional(aggregate.durationMs, metric.durationMs);
    aggregate.inputTokens = addOptional(
      aggregate.inputTokens,
      metric.inputTokens,
    );
    aggregate.outputTokens = addOptional(
      aggregate.outputTokens,
      metric.outputTokens,
    );
    aggregate.cacheReadTokens = addOptional(
      aggregate.cacheReadTokens,
      metric.cacheReadTokens,
    );
    aggregate.cacheWriteTokens = addOptional(
      aggregate.cacheWriteTokens,
      metric.cacheWriteTokens,
    );
    aggregate.totalTokens = addOptional(
      aggregate.totalTokens,
      metric.totalTokens,
    );
    aggregate.totalCostUsd = addOptional(
      aggregate.totalCostUsd,
      metric.totalCostUsd,
    );
    aggregate.turns += metric.turns;
    aggregate.turnsWithUsage += metric.turnsWithUsage;
    aggregate.totalToolCalls += metric.totalToolCalls;
    aggregate.failedToolCalls += metric.failedToolCalls;
    aggregate.model ??= metric.model;
    aggregate.provider ??= metric.provider;
    aggregate.sessionId ??= metric.sessionId;
    aggregate.error ??= metric.error;
    aggregate.responseIds.push(...metric.responseIds);
    aggregate.stopReasons.push(...metric.stopReasons);
    aggregate.usageTurns.push(...metric.usageTurns);

    for (const [toolName, count] of Object.entries(metric.toolCalls)) {
      aggregate.toolCalls[toolName] =
        (aggregate.toolCalls[toolName] ?? 0) + count;
    }
    for (const [toolName, count] of Object.entries(
      metric.failedToolCallsByName,
    )) {
      aggregate.failedToolCallsByName[toolName] =
        (aggregate.failedToolCallsByName[toolName] ?? 0) + count;
    }
  }

  return aggregate;
}
