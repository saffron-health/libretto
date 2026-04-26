/**
 * API-based snapshot analyzer.
 *
 * Sends the DOM snapshot (condensed or full depending on sizing) and screenshot
 * directly to a supported API provider via the Vercel AI SDK, without spawning
 * a CLI process.
 */

import { readFileSync } from "node:fs";
import type { LoggerApi } from "../../shared/logger/index.js";
import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "./resolve-model.js";
import { resolveOpenAiCredentials } from "./openai-credentials.js";
import {
  InterpretResultSchema,
  buildInlinePromptSelection,
  getMimeType,
  readFileAsBase64,
  type InterpretResult,
  type InterpretArgs,
} from "./snapshot-analyzer.js";
import { readSnapshotModel } from "./config.js";
import { resolveSnapshotApiModelOrThrow } from "./ai-model.js";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

export function parseCodexResponsesSse(responseText: string): InterpretResult {
  let outputText = "";
  for (const line of responseText.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice("data: ".length).trim();
    if (!payload || payload === "[DONE]") continue;

    let event: {
      type?: string;
      delta?: string;
      text?: string;
      error?: { message?: string };
      response?: { error?: { message?: string } };
    };
    try {
      event = JSON.parse(payload) as typeof event;
    } catch {
      continue;
    }

    if (event.type === "response.output_text.delta" && event.delta) {
      outputText += event.delta;
    } else if (event.type === "response.output_text.done" && event.text) {
      outputText = event.text;
    } else if (event.type === "error") {
      throw new Error(event.error?.message || responseText);
    } else if (event.type === "response.completed" && event.response?.error) {
      throw new Error(event.response.error.message || responseText);
    }
  }

  if (!outputText.trim()) {
    throw new Error("Codex OAuth response did not include output text.");
  }

  return InterpretResultSchema.parse(JSON.parse(outputText));
}

async function runCodexOAuthInterpretObject(args: {
  token: string;
  accountId: string;
  modelId: string;
  prompt: string;
  imageBase64: string;
  imageMimeType: string;
}): Promise<InterpretResult> {
  const response = await fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.token}`,
      "chatgpt-account-id": args.accountId,
      "OpenAI-Beta": "responses=experimental",
      originator: "libretto",
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: args.modelId,
      store: false,
      stream: true,
      instructions:
        "Analyze the DOM snapshot and screenshot. Return only an object that matches the requested JSON schema.",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: args.prompt },
            {
              type: "input_image",
              image_url: `data:${args.imageMimeType};base64,${args.imageBase64}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "snapshot_analysis",
          schema: z.toJSONSchema(InterpretResultSchema),
          strict: true,
        },
      },
      include: ["reasoning.encrypted_content"],
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(responseText || response.statusText);
  }

  return parseCodexResponsesSse(responseText);
}

export async function runApiInterpret(
  args: InterpretArgs,
  logger: LoggerApi,
  snapshotModel: string | null = readSnapshotModel(),
): Promise<void> {
  const selection = resolveSnapshotApiModelOrThrow(snapshotModel);

  logger.info("api-interpret-start", {
    objective: args.objective,
    pngPath: args.pngPath,
    htmlPath: args.htmlPath,
    condensedHtmlPath: args.condensedHtmlPath,
    model: selection.model,
    modelSource: selection.source,
  });

  const fullHtmlContent = readFileSync(args.htmlPath, "utf-8");
  const condensedHtmlContent = readFileSync(args.condensedHtmlPath, "utf-8");

  const promptSelection = buildInlinePromptSelection(
    args,
    fullHtmlContent,
    condensedHtmlContent,
    selection.model,
  );

  logger.info("api-interpret-dom-selection", {
    configuredModel: promptSelection.stats.configuredModel,
    fullDomEstimatedTokens: promptSelection.stats.fullDomEstimatedTokens,
    condensedDomEstimatedTokens:
      promptSelection.stats.condensedDomEstimatedTokens,
    contextWindowTokens: promptSelection.budget.contextWindowTokens,
    promptBudgetTokens: promptSelection.budget.promptBudgetTokens,
    selectedDom: promptSelection.domSource,
    selectedHtmlEstimatedTokens: promptSelection.htmlEstimatedTokens,
    selectedPromptEstimatedTokens: promptSelection.promptEstimatedTokens,
    selectionReason: promptSelection.selectionReason,
    truncated: promptSelection.truncated,
  });

  const imageBase64 = readFileAsBase64(args.pngPath);
  const imageMimeType = getMimeType(args.pngPath);
  const imageBytes = Buffer.from(imageBase64, "base64");

  const openAiCredentials = resolveOpenAiCredentials();
  const parsed: InterpretResult =
    selection.provider === "openai" &&
    openAiCredentials?.kind === "codex-oauth"
      ? await runCodexOAuthInterpretObject({
          token: openAiCredentials.token,
          accountId: openAiCredentials.accountId,
          modelId: selection.model.slice(selection.model.indexOf("/") + 1),
          prompt: promptSelection.prompt,
          imageBase64,
          imageMimeType,
        })
      : InterpretResultSchema.parse(
          (
            await generateObject({
              model: await resolveModel(selection.model),
              schema: InterpretResultSchema,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: promptSelection.prompt },
                    {
                      type: "image",
                      image: imageBytes,
                      mediaType: imageMimeType,
                    },
                  ],
                },
              ],
              temperature: 0.1,
            })
          ).object,
        );

  logger.info("api-interpret-success", {
    selectorCount: parsed.selectors.length,
    answer: parsed.answer.slice(0, 200),
  });

  console.log("");
  console.log("Analysis:");
  console.log(parsed.answer);
  if (parsed.selectors.length > 0) {
    console.log("");
    console.log("Selectors:");
    parsed.selectors.forEach((selector, index) => {
      console.log(`  ${index + 1}. ${selector.label}: ${selector.selector}`);
    });
  }
  if (parsed.notes?.trim()) {
    console.log("");
    console.log(`Notes: ${parsed.notes.trim()}`);
  }
}
