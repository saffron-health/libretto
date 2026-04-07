import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { join, relative } from "node:path";
import { Type } from "@sinclair/typebox";
import {
  AuthStorage,
  createAgentSession,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { buildAgenticEvaluatorPrompt } from "./prompt.js";
import {
  AGENTIC_EVALUATOR_ID,
  AGENTIC_EVALUATOR_PROMPT_VERSION,
  DEFAULT_AGENTIC_EVALUATOR_MAX_TURNS,
  parseAgenticEvaluation,
  type AgenticEvaluation,
} from "./schema.js";

export type AgenticJudgeResult = {
  evaluation: "YES" | "NO" | "INVALID";
  reasoning: string;
};

export type AgenticEvaluatorRunResult = {
  judge: AgenticJudgeResult;
  agenticEvaluation: AgenticEvaluation | null;
  analysisPath: string;
  transcriptPath: string;
  resultPath: string | null;
};

type TranscriptUsageEntry = {
  totalTokens: number;
  costUsd: number | null;
};

type TranscriptUsageSummary = {
  totalTokens: number;
  totalCostUsd: number | null;
};

type EvaluateCaseWithAgentOptions = {
  runDir: string;
  promptPath: string;
  transcriptPath: string;
  apiKey: string;
  modelProvider: string;
  modelId: string;
  maxTurns?: number;
  timeoutMs?: number;
};

const DEFAULT_AGENTIC_EVALUATOR_TIMEOUT_MS = 180_000;
const EVALUATOR_TRANSCRIPT_EVENT_TYPES = new Set([
  "message_end",
  "tool_execution_start",
  "tool_execution_end",
]);

function extractAssistantUsageEntry(
  event: AgentSessionEvent,
): TranscriptUsageEntry | null {
  if (event.type !== "message_end") {
    return null;
  }

  const typedEvent = event as AgentSessionEvent & {
    message?: {
      role?: string;
      usage?: {
        totalTokens?: number;
        cost?: { total?: number };
      };
    };
    usage?: {
      totalTokens?: number;
      cost?: { total?: number };
    };
  };

  if (typedEvent.message?.role !== "assistant") {
    return null;
  }

  const usage = typedEvent.usage ?? typedEvent.message?.usage;
  const totalTokens =
    typeof usage?.totalTokens === "number" && Number.isFinite(usage.totalTokens)
      ? usage.totalTokens
      : 0;
  const costUsd =
    typeof usage?.cost?.total === "number" && Number.isFinite(usage.cost.total)
      ? usage.cost.total
      : null;

  return {
    totalTokens,
    costUsd,
  };
}

function summarizeTranscriptUsage(
  entries: TranscriptUsageEntry[],
): TranscriptUsageSummary {
  return entries.reduce<TranscriptUsageSummary>(
    (summary, entry) => ({
      totalTokens: summary.totalTokens + entry.totalTokens,
      totalCostUsd:
        entry.costUsd == null
          ? summary.totalCostUsd
          : (summary.totalCostUsd ?? 0) + entry.costUsd,
    }),
    {
      totalTokens: 0,
      totalCostUsd: null,
    },
  );
}

function formatUsd(value: number | null | undefined): string {
  return value == null ? "-" : `$${value.toFixed(4)}`;
}

function buildInvalidJudge(reasoning: string): AgenticJudgeResult {
  return {
    evaluation: "INVALID",
    reasoning,
  };
}

function buildReportEvaluationTool(args: {
  onAccepted: (evaluation: AgenticEvaluation) => void;
  onMalformed: (errorMessage: string) => void;
  onDuplicate: () => void;
}): ToolDefinition {
  return {
    name: "report_evaluation",
    label: "report_evaluation",
    description:
      "Submit the final structured WebVoyager evaluation exactly once after inspecting the evidence.",
    parameters: Type.Object({
      evaluatorId: Type.Literal(AGENTIC_EVALUATOR_ID),
      evaluation: Type.Union([Type.Literal("YES"), Type.Literal("NO")]),
      reasoning: Type.String({ minLength: 1 }),
      metadata: Type.Object({
        model: Type.String({ minLength: 1 }),
        temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        promptVersion: Type.String({ minLength: 1 }),
        durationMs: Type.Number({ minimum: 0 }),
        maxTurns: Type.Integer({ minimum: 1 }),
        totalTokens: Type.Optional(Type.Integer({ minimum: 0 })),
        costUsd: Type.Optional(Type.Number({ minimum: 0 })),
      }),
    }),
    async execute(_toolCallId, params) {
      try {
        const evaluation = parseAgenticEvaluation(params);
        args.onAccepted(evaluation);
        return {
          content: [
            {
              type: "text",
              text: "Evaluation accepted. Do not call report_evaluation again.",
            },
          ],
          details: undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("already submitted")) {
          args.onDuplicate();
        } else {
          args.onMalformed(message);
        }
        throw error;
      }
    },
  };
}

async function runWithTimeout<T>(args: {
  timeoutMs: number;
  operation: () => Promise<T>;
  onTimeout: () => Promise<void>;
}): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      args.operation(),
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          void args.onTimeout().catch(() => {});
          reject(
            new Error(`Agentic evaluator timed out after ${args.timeoutMs}ms.`),
          );
        }, args.timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function renderEvaluationAnalysis(args: {
  promptPath: string;
  transcriptPath: string;
  evaluation: AgenticEvaluation;
}): string {
  const { evaluation, promptPath, transcriptPath } = args;

  return [
    "# Agentic Evaluator Analysis",
    "",
    `- Verdict: ${evaluation.evaluation}`,
    `- Evaluator ID: ${evaluation.evaluatorId}`,
    `- Model: ${evaluation.metadata.model}`,
    `- Temperature: ${evaluation.metadata.temperature ?? "-"}`,
    `- Prompt version: ${evaluation.metadata.promptVersion}`,
    `- Duration (ms): ${evaluation.metadata.durationMs}`,
    `- Max turns: ${evaluation.metadata.maxTurns}`,
    `- Total tokens: ${evaluation.metadata.totalTokens ?? "-"}`,
    `- Cost (USD): ${formatUsd(evaluation.metadata.costUsd)}`,
    "",
    "## Canonical inputs",
    "",
    `- prompt.md: ${promptPath}`,
    `- transcript.jsonl: ${transcriptPath}`,
    "",
    "## Reasoning",
    "",
    evaluation.reasoning.trim(),
    "",
  ].join("\n");
}

function renderInvalidAnalysis(args: {
  promptPath: string;
  transcriptPath: string;
  reasoning: string;
}): string {
  return [
    "# Agentic Evaluator Analysis",
    "",
    "- Verdict: INVALID",
    "",
    "## Canonical inputs",
    "",
    `- prompt.md: ${args.promptPath}`,
    `- transcript.jsonl: ${args.transcriptPath}`,
    "",
    "## Integration failure",
    "",
    args.reasoning,
    "",
  ].join("\n");
}

export async function evaluateCaseWithAgent(
  opts: EvaluateCaseWithAgentOptions,
): Promise<AgenticEvaluatorRunResult> {
  const evaluatorDir = join(opts.runDir, "evaluator");
  await mkdir(evaluatorDir, { recursive: true });

  const evaluatorAgentDir = join(evaluatorDir, ".pi");
  const evaluatorTranscriptPath = join(evaluatorDir, "transcript.jsonl");
  const evaluatorResultPath = join(evaluatorDir, "result.json");
  const evaluatorAnalysisPath = join(evaluatorDir, "analysis.md");
  const promptPathForPrompt =
    relative(opts.runDir, opts.promptPath) || "prompt.md";
  const transcriptPathForPrompt =
    relative(opts.runDir, opts.transcriptPath) || "transcript.jsonl";
  const maxTurns = opts.maxTurns ?? DEFAULT_AGENTIC_EVALUATOR_MAX_TURNS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_AGENTIC_EVALUATOR_TIMEOUT_MS;
  const modelName = `${opts.modelProvider}/${opts.modelId}`;
  const prompt = buildAgenticEvaluatorPrompt({
    promptPath: promptPathForPrompt,
    transcriptPath: transcriptPathForPrompt,
    modelName,
    maxTurns,
  });
  const startedAt = Date.now();
  const transcriptStream = createWriteStream(evaluatorTranscriptPath, {
    flags: "w",
  });
  transcriptStream.write(
    `${JSON.stringify({
      ts: new Date(startedAt).toISOString(),
      type: "evaluator_system_prompt",
      text: prompt.system,
    })}\n`,
  );
  transcriptStream.write(
    `${JSON.stringify({
      ts: new Date(startedAt).toISOString(),
      type: "evaluator_user_prompt",
      text: prompt.user,
    })}\n`,
  );

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: opts.runDir,
    agentDir: evaluatorAgentDir,
    settingsManager,
    extensionFactories: [],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: prompt.system,
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    appendSystemPromptOverride: () => [],
  });

  let submittedEvaluation: AgenticEvaluation | null = null;
  let malformedReportError: string | null = null;
  let duplicateReport = false;
  let assistantTurnCount = 0;
  let turnLimitExceeded = false;
  let timedOut = false;
  let thrownError: unknown;
  const usageEntries: TranscriptUsageEntry[] = [];

  const reportEvaluationTool = buildReportEvaluationTool({
    onAccepted(evaluation) {
      if (submittedEvaluation) {
        duplicateReport = true;
        throw new Error("report_evaluation already submitted.");
      }
      submittedEvaluation = evaluation;
    },
    onMalformed(errorMessage) {
      malformedReportError = errorMessage;
    },
    onDuplicate() {
      duplicateReport = true;
    },
  });

  let session: AgentSession;

  try {
    await resourceLoader.reload();

    const authStorage = AuthStorage.create(
      join(evaluatorAgentDir, "auth.json"),
    );
    authStorage.setRuntimeApiKey(opts.modelProvider, opts.apiKey);
    const modelRegistry = new ModelRegistry(authStorage);
    const model = modelRegistry.find(opts.modelProvider, opts.modelId);

    if (!model) {
      throw new Error(`unknown Pi model ${modelName}`);
    }

    const createdSession = await createAgentSession({
      cwd: opts.runDir,
      agentDir: evaluatorAgentDir,
      model,
      thinkingLevel: "medium",
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
      tools: [
        createReadTool(opts.runDir),
        createLsTool(opts.runDir),
        createGrepTool(opts.runDir),
        createFindTool(opts.runDir),
      ],
      customTools: [reportEvaluationTool],
    });

    session = createdSession.session;
  } catch (error) {
    const reasoning = `Agentic evaluator integration failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
    transcriptStream.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        type: "evaluator_bootstrap_error",
        error: reasoning,
      })}\n`,
    );
    transcriptStream.end();
    await finished(transcriptStream);
    await writeFile(
      evaluatorAnalysisPath,
      renderInvalidAnalysis({
        promptPath: promptPathForPrompt,
        transcriptPath: transcriptPathForPrompt,
        reasoning,
      }),
      "utf8",
    );

    return {
      judge: buildInvalidJudge(reasoning),
      agenticEvaluation: null,
      analysisPath: evaluatorAnalysisPath,
      transcriptPath: evaluatorTranscriptPath,
      resultPath: null,
    };
  }

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (EVALUATOR_TRANSCRIPT_EVENT_TYPES.has(event.type)) {
      transcriptStream.write(`${JSON.stringify(event)}\n`);
    }

    const usageEntry = extractAssistantUsageEntry(event);
    if (usageEntry) {
      usageEntries.push(usageEntry);
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      assistantTurnCount += 1;
      if (assistantTurnCount > maxTurns && !turnLimitExceeded) {
        turnLimitExceeded = true;
        void session.abort().catch(() => {});
      }
    }
  });

  try {
    await runWithTimeout({
      timeoutMs,
      operation: () => session.prompt(prompt.user),
      onTimeout: async () => {
        timedOut = true;
        await session.abort();
      },
    });
  } catch (error) {
    thrownError = error;
  } finally {
    unsubscribe();
    session.dispose();
    transcriptStream.end();
    await finished(transcriptStream);
  }

  const durationMs = Date.now() - startedAt;
  const usageSummary = summarizeTranscriptUsage(usageEntries);

  let invalidReason: string | null = null;
  if (timedOut) {
    invalidReason = `Agentic evaluator integration failed: timed out after ${timeoutMs}ms.`;
  } else if (turnLimitExceeded) {
    invalidReason = `Agentic evaluator integration failed: exceeded the max turn budget (${maxTurns}).`;
  } else if (thrownError) {
    invalidReason = `Agentic evaluator integration failed: ${
      thrownError instanceof Error ? thrownError.message : String(thrownError)
    }`;
  } else if (duplicateReport) {
    invalidReason =
      "Agentic evaluator integration failed: report_evaluation was submitted more than once.";
  } else if (!submittedEvaluation) {
    invalidReason = malformedReportError
      ? `Agentic evaluator integration failed: malformed report_evaluation payload (${malformedReportError}).`
      : "Agentic evaluator integration failed: evaluator finished without calling report_evaluation.";
  }

  if (invalidReason) {
    await writeFile(
      evaluatorAnalysisPath,
      renderInvalidAnalysis({
        promptPath: promptPathForPrompt,
        transcriptPath: transcriptPathForPrompt,
        reasoning: invalidReason,
      }),
      "utf8",
    );

    return {
      judge: buildInvalidJudge(invalidReason),
      agenticEvaluation: null,
      analysisPath: evaluatorAnalysisPath,
      transcriptPath: evaluatorTranscriptPath,
      resultPath: null,
    };
  }

  const evaluation = parseAgenticEvaluation({
    ...submittedEvaluation!,
    metadata: {
      model: modelName,
      promptVersion: AGENTIC_EVALUATOR_PROMPT_VERSION,
      durationMs,
      maxTurns,
      ...(usageSummary.totalTokens > 0
        ? { totalTokens: usageSummary.totalTokens }
        : {}),
      ...(usageSummary.totalCostUsd != null
        ? { costUsd: usageSummary.totalCostUsd }
        : {}),
    },
  });

  await writeFile(
    evaluatorResultPath,
    JSON.stringify(evaluation, null, 2),
    "utf8",
  );
  await writeFile(
    evaluatorAnalysisPath,
    renderEvaluationAnalysis({
      promptPath: promptPathForPrompt,
      transcriptPath: transcriptPathForPrompt,
      evaluation,
    }),
    "utf8",
  );

  return {
    judge: {
      evaluation: evaluation.evaluation,
      reasoning: evaluation.reasoning,
    },
    agenticEvaluation: evaluation,
    analysisPath: evaluatorAnalysisPath,
    transcriptPath: evaluatorTranscriptPath,
    resultPath: evaluatorResultPath,
  };
}
