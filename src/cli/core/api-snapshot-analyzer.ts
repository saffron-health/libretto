/**
 * API-based snapshot analyzer.
 *
 * Sends the DOM snapshot (condensed or full depending on sizing) and screenshot
 * directly to the Anthropic API via the Vercel AI SDK, without spawning a CLI process.
 *
 * Requires ANTHROPIC_API_KEY to be set (loaded from .env at project root if present).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { LoggerApi } from "../../shared/logger/index.js";
import { createLLMClient } from "../../shared/llm/client.js";
import { REPO_ROOT } from "./context.js";
import {
  InterpretResultSchema,
  buildInlinePromptSelection,
  getMimeType,
  readFileAsBase64,
  type InterpretArgs,
} from "./snapshot-analyzer.js";
import type { AiConfig } from "./ai-config.js";

function readWorktreeEnvPath(): string | null {
  const gitPath = join(REPO_ROOT, ".git");
  if (!existsSync(gitPath)) return null;

  try {
    const gitPointer = readFileSync(gitPath, "utf-8").trim();
    const match = gitPointer.match(/^gitdir:\s*(.+)$/i);
    if (!match?.[1]) return null;
    const worktreeGitDir = resolve(REPO_ROOT, match[1].trim());
    const commonGitDir = resolve(worktreeGitDir, "..", "..");
    return join(dirname(commonGitDir), ".env");
  } catch {
    return null;
  }
}

/** Reads .env from the current repo root, then falls back to the shared root for Git worktrees. */
function loadDotEnv(): void {
  const envPathCandidates = [
    join(REPO_ROOT, ".env"),
    readWorktreeEnvPath(),
  ].filter((value): value is string => Boolean(value));

  const envPath = envPathCandidates.find((candidate) => existsSync(candidate));
  if (!envPath) return;

  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

/** Anthropic model used for API-based snapshot analysis. */
const API_SNAPSHOT_MODEL = "anthropic/claude-sonnet-4-6";

/** AiConfig stub used only for context-window and token-budget calculations. */
const API_SNAPSHOT_CONFIG: AiConfig = {
  preset: "claude",
  commandPrefix: ["claude"],
  model: "claude-sonnet-4-6",
  updatedAt: new Date(0).toISOString(),
};

export async function runApiInterpret(
  args: InterpretArgs,
  logger: LoggerApi,
): Promise<void> {
  loadDotEnv();

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to the .env file at the project root or set it as an environment variable.",
    );
  }

  logger.info("api-interpret-start", {
    objective: args.objective,
    pngPath: args.pngPath,
    htmlPath: args.htmlPath,
    condensedHtmlPath: args.condensedHtmlPath,
    model: API_SNAPSHOT_MODEL,
  });

  const fullHtmlContent = readFileSync(args.htmlPath, "utf-8");
  const condensedHtmlContent = readFileSync(args.condensedHtmlPath, "utf-8");

  const selection = buildInlinePromptSelection(
    args,
    fullHtmlContent,
    condensedHtmlContent,
    API_SNAPSHOT_CONFIG,
  );

  logger.info("api-interpret-dom-selection", {
    configuredModel: selection.stats.configuredModel,
    fullDomEstimatedTokens: selection.stats.fullDomEstimatedTokens,
    condensedDomEstimatedTokens: selection.stats.condensedDomEstimatedTokens,
    contextWindowTokens: selection.budget.contextWindowTokens,
    promptBudgetTokens: selection.budget.promptBudgetTokens,
    selectedDom: selection.domSource,
    selectedHtmlEstimatedTokens: selection.htmlEstimatedTokens,
    selectedPromptEstimatedTokens: selection.promptEstimatedTokens,
    selectionReason: selection.selectionReason,
    truncated: selection.truncated,
  });

  const imageBase64 = readFileAsBase64(args.pngPath);
  const imageMimeType = getMimeType(args.pngPath);
  const imageBytes = Buffer.from(imageBase64, "base64");

  const client = createLLMClient(API_SNAPSHOT_MODEL);

  const result = await client.generateObjectFromMessages({
    schema: InterpretResultSchema,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: selection.prompt },
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
