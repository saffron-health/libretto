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
  process.env.BENCH_JUDGE_MODEL ?? "vertex/gemini-2.5-flash";

// ---------------------------------------------------------------------------
// System prompt (mirrors Stagehand V3Evaluator multi-screenshot approach)
// ---------------------------------------------------------------------------

function buildSystemPrompt(hasAgentReasoning: boolean): string {
  return `You are an expert evaluator that confidently returns YES or NO given a question and multiple screenshots showing the progression of a task.
${hasAgentReasoning ? "You also have access to the agent's detailed reasoning and thought process throughout the task." : ""}
Analyze ALL screenshots to understand the complete journey. Look for evidence of task completion across all screenshots, not just the last one.
Success criteria may appear at different points in the sequence (confirmation messages, intermediate states, etc).
${hasAgentReasoning ? "The agent's reasoning provides crucial context about what actions were attempted, what was observed, and the decision-making process. Use this alongside the visual evidence to make a comprehensive evaluation." : ""}
Today's date is ${new Date().toLocaleDateString()}`;
}

// ---------------------------------------------------------------------------
// evaluate()
// ---------------------------------------------------------------------------

export async function evaluateWithScreenshots(opts: {
  task: string;
  screenshots: Buffer[];
  agentReasoning: string | null;
}): Promise<JudgeResult> {
  const { task, screenshots, agentReasoning } = opts;

  if (screenshots.length === 0) {
    return {
      evaluation: "INVALID",
      reasoning:
        "No screenshots captured; matching Stagehand's multi-screenshot evaluator, this benchmark run cannot be judged.",
    };
  }

  // Build the multimodal user message
  const contentParts: MessageContentPart[] = [];

  // Build question text with reasoning context and screenshot framing
  const hasReasoning = !!agentReasoning?.trim();
  let questionText: string;
  if (hasReasoning) {
    questionText = `Question: Did the agent successfully complete this task: "${task}"?\n\nAgent's reasoning and actions throughout the task:\n${agentReasoning!.trim()}\n\nI'm providing ${screenshots.length} screenshots showing the progression of the task. Please analyze both the agent's reasoning and all screenshots to determine if the task was completed successfully.`;
  } else {
    questionText = `Did the agent successfully complete this task: "${task}"?\n\nI'm providing ${screenshots.length} screenshots showing the progression of the task. Please analyze all of them to determine if the task was completed successfully.`;
  }

  contentParts.push({
    type: "text",
    text: questionText,
  });

  // Add screenshots as image parts
  for (const screenshot of screenshots) {
    contentParts.push({
      type: "image",
      image: screenshot,
      mediaType: "image/png",
    });
  }

  const systemPrompt = buildSystemPrompt(hasReasoning);

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
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
