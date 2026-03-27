import { z } from "zod";
import {
  createLLMClient,
  type Message,
  type MessageContentPart,
} from "../libretto-internals.js";

// ---------------------------------------------------------------------------
// Schema & types
// ---------------------------------------------------------------------------

const EvaluationSchema = z.object({
  evaluation: z.enum(["YES", "NO"]),
  reasoning: z.string().min(1),
});

export type JudgeResult = {
  evaluation: "YES" | "NO" | "INVALID";
  reasoning: string;
};

// ---------------------------------------------------------------------------
// Default judge model
// ---------------------------------------------------------------------------

const JUDGE_MODEL =
  process.env.BENCH_JUDGE_MODEL ?? "anthropic/claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// System prompt (mirrors Stagehand V3Evaluator multi-screenshot approach)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert evaluator for browser automation agents.

You will be shown a sequence of screenshots captured during the agent's task execution, plus the agent's own reasoning about what it accomplished.

Your job:
1. Analyze ALL screenshots to understand the complete journey the agent took.
2. Look for visual evidence of task completion across the full screenshot sequence.
3. Consider the agent's reasoning, but verify it against the visual evidence.
4. A task is successful ONLY if there is clear visual evidence that the core objective was achieved, not just that the agent navigated to some pages.

Return a JSON object with:
- "evaluation": "YES" if the task was completed successfully, "NO" otherwise.
- "reasoning": A brief explanation of your verdict referencing the visual evidence.`;

// ---------------------------------------------------------------------------
// evaluate()
// ---------------------------------------------------------------------------

export async function evaluateWithScreenshots(opts: {
  task: string;
  screenshots: Buffer[];
  agentReasoning: string | null;
}): Promise<JudgeResult> {
  const { task, screenshots, agentReasoning } = opts;

  if (screenshots.length === 0 && !agentReasoning?.trim()) {
    return {
      evaluation: "NO",
      reasoning:
        "No screenshots captured and no agent reasoning available — cannot verify task completion.",
    };
  }

  // Build the multimodal user message
  const contentParts: MessageContentPart[] = [];

  contentParts.push({
    type: "text",
    text: `Did the agent successfully complete this task: "${task}"?`,
  });

  // Add screenshots as image parts
  for (let i = 0; i < screenshots.length; i++) {
    contentParts.push({
      type: "text",
      text: `Screenshot ${i + 1} of ${screenshots.length}:`,
    });
    contentParts.push({
      type: "image",
      image: screenshots[i],
      mediaType: "image/png",
    });
  }

  // Add agent reasoning if available
  if (agentReasoning?.trim()) {
    contentParts.push({
      type: "text",
      text: `\nAgent's reasoning about what it accomplished:\n${agentReasoning.trim()}`,
    });
  }

  const messages: Message[] = [
    { role: "user", content: SYSTEM_PROMPT },
    {
      role: "assistant",
      content:
        "I understand. Please provide the task, screenshots, and agent reasoning for me to evaluate.",
    },
    { role: "user", content: contentParts },
  ];

  const client = createLLMClient(JUDGE_MODEL);

  try {
    const result = await client.generateObjectFromMessages({
      messages,
      schema: EvaluationSchema,
      temperature: 0,
    });
    return {
      evaluation: result.evaluation,
      reasoning: result.reasoning,
    };
  } catch (error) {
    // Parse failures → INVALID
    return {
      evaluation: "INVALID",
      reasoning: `Judge failed to produce a valid response: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
