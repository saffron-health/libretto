/**
 * API-based snapshot analyzer.
 *
 * Sends the DOM snapshot (condensed or full depending on sizing) and screenshot
 * directly to a supported API provider via the Vercel AI SDK, without spawning
 * a CLI process.
 */

import { readFileSync } from "node:fs";
import type { LoggerApi } from "../../shared/logger/index.js";
import { createLLMClient } from "../../shared/llm/client.js";
import {
  InterpretResultSchema,
  buildInlinePromptSelection,
  getMimeType,
  readFileAsBase64,
  type InterpretArgs,
} from "./snapshot-analyzer.js";
import { readAiConfig } from "./ai-config.js";
import {
  buildSnapshotApiSelectionConfig,
  loadSnapshotEnv,
  resolveSnapshotApiModelOrThrow,
} from "./snapshot-api-config.js";

export async function runApiInterpret(
  args: InterpretArgs,
  logger: LoggerApi,
): Promise<void> {
  loadSnapshotEnv();
  const configuredAi = readAiConfig();
  const selection = resolveSnapshotApiModelOrThrow(configuredAi);
  const selectionConfig = buildSnapshotApiSelectionConfig(selection, configuredAi);

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
    selectionConfig,
  );

  logger.info("api-interpret-dom-selection", {
    configuredModel: promptSelection.stats.configuredModel,
    fullDomEstimatedTokens: promptSelection.stats.fullDomEstimatedTokens,
    condensedDomEstimatedTokens: promptSelection.stats.condensedDomEstimatedTokens,
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

  const client = createLLMClient(selection.model);

  const result = await client.generateObjectFromMessages({
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
  });

  const parsed = InterpretResultSchema.parse(result);

  logger.info("api-interpret-success", {
    selectorCount: parsed.selectors.length,
    answer: parsed.answer.slice(0, 200),
    consultedFiles: parsed.debug?.consultedFiles ?? [],
  });

  const outputLines: string[] = [];
  outputLines.push("Interpretation (via API):");
  outputLines.push(`Answer: ${parsed.answer}`);
  outputLines.push("");
  if (parsed.selectors.length === 0) {
    outputLines.push("Selectors: none found.");
  } else {
    outputLines.push("Selectors:");
    parsed.selectors.forEach((selector, index) => {
      outputLines.push(`  ${index + 1}. ${selector.label}`);
      outputLines.push(`     selector: ${selector.selector}`);
      outputLines.push(`     rationale: ${selector.rationale}`);
    });
  }
  if (parsed.notes.trim()) {
    outputLines.push("");
    outputLines.push(`Notes: ${parsed.notes.trim()}`);
  }
  if (
    parsed.debug &&
    (parsed.debug.consultedFiles.length > 0 ||
      parsed.debug.analysisSteps.length > 0)
  ) {
    outputLines.push("");
    outputLines.push("Debug:");
    if (parsed.debug.consultedFiles.length > 0) {
      outputLines.push(
        `  consultedFiles: ${parsed.debug.consultedFiles.join(", ")}`,
      );
    }
    if (parsed.debug.analysisSteps.length > 0) {
      outputLines.push("  analysisSteps:");
      parsed.debug.analysisSteps.forEach((step, index) => {
        outputLines.push(`    ${index + 1}. ${step}`);
      });
    }
  }

  console.log(outputLines.join("\n"));
}
