import { z } from "zod";

export const AGENTIC_EVALUATOR_ID = "webvoyager-pi-agent-v1" as const;
export const AGENTIC_EVALUATOR_PROMPT_VERSION =
  "webvoyager-pi-agent-v1.phase-2b" as const;
export const DEFAULT_AGENTIC_EVALUATOR_MAX_TURNS = 100 as const;

export const AgenticEvaluationMetadataSchema = z.object({
  model: z.string().min(1),
  temperature: z.number().min(0).max(1).optional(),
  promptVersion: z.string().min(1),
  durationMs: z.number().nonnegative(),
  maxTurns: z.number().int().positive(),
  totalTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});

export const AgenticEvaluationSchema = z.object({
  evaluatorId: z.literal(AGENTIC_EVALUATOR_ID),
  evaluation: z.enum(["YES", "NO"]),
  reasoning: z.string().trim().min(1),
  metadata: AgenticEvaluationMetadataSchema,
});

export type AgenticEvaluation = z.infer<typeof AgenticEvaluationSchema>;
export type AgenticEvaluationMetadata = z.infer<
  typeof AgenticEvaluationMetadataSchema
>;
export type AgenticEvaluationVerdict = AgenticEvaluation["evaluation"];

export function parseAgenticEvaluation(value: unknown): AgenticEvaluation {
  return AgenticEvaluationSchema.parse(value);
}
