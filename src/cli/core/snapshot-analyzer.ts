/**
 * CLI-agent-based snapshot analyzer (legacy path).
 *
 * This module spawns an external coding agent (codex, claude, or gemini CLI)
 * as a child process to analyze snapshots. It is NOT currently used by the
 * snapshot command — analysis now goes through the API path in
 * api-snapshot-analyzer.ts. This code is preserved so we can switch back
 * to the CLI-agent approach if needed.
 *
 * Shared types and utilities (InterpretResultSchema, buildInlinePromptSelection,
 * formatInterpretationOutput, etc.) are still actively used by the API analyzer.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { LoggerApi } from "../../shared/logger/index.js";
// Used by the legacy CLI-agent path (UserCodingAgent) which is preserved but
// not wired into the snapshot command. The active config schema (ai-config.ts)
// no longer has preset/commandPrefix — this type is kept for the legacy code.
type LegacyAiConfig = {
  preset: "codex" | "claude" | "gemini";
  commandPrefix: string[];
};

export type ScreenshotPair = {
  pngPath: string;
  htmlPath: string;
  condensedHtmlPath: string;
  baseName: string;
};

export type InterpretArgs = {
  objective: string;
  session: string;
  context: string;
  pngPath: string;
  htmlPath: string;
  condensedHtmlPath: string;
};

export const InterpretResultSchema = z.object({
  answer: z.string(),
  selectors: z.array(
    z.object({
      label: z.string(),
      selector: z.string(),
      rationale: z.string(),
    }),
  ),
  notes: z.string(),
});

export type InterpretResult = z.infer<typeof InterpretResultSchema>;

type ExternalCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type SnapshotBudget = {
  contextWindowTokens: number;
  outputReserveTokens: number;
  promptBudgetTokens: number;
  source: string;
};

type SnapshotDomStats = {
  fullDomChars: number;
  fullDomEstimatedTokens: number;
  condensedDomChars: number;
  condensedDomEstimatedTokens: number;
  configuredModel: string;
};

type InlinePromptSelection = {
  prompt: string;
  domSource: "full" | "condensed";
  domLabel: "full DOM" | "condensed DOM";
  htmlChars: number;
  htmlEstimatedTokens: number;
  promptEstimatedTokens: number;
  truncated: boolean;
  selectionReason: string;
  budget: SnapshotBudget;
  stats: SnapshotDomStats;
};

abstract class UserCodingAgent {
  protected constructor(protected readonly config: LegacyAiConfig) {}

  static resolveFromConfig(config: LegacyAiConfig): UserCodingAgent {
    switch (config.preset) {
      case "codex":
        return new CodexUserCodingAgent(config);
      case "claude":
        return new ClaudeUserCodingAgent(config);
      case "gemini":
        return new GeminiUserCodingAgent(config);
    }
  }

  static readConfiguredConfig(): LegacyAiConfig | null {
    // Legacy: this would read from the old config format. Not used in the
    // current API-based analysis path.
    return null;
  }

  static getConfigured(): UserCodingAgent | null {
    const config = this.readConfiguredConfig();
    return config ? this.resolveFromConfig(config) : null;
  }

  get snapshotAnalyzerConfig(): LegacyAiConfig {
    return this.config;
  }

  protected get command(): string {
    const command = this.config.commandPrefix[0];
    if (!command) {
      throw new Error("AI config is invalid: command prefix is empty.");
    }
    return command;
  }

  protected get baseArgs(): string[] {
    return this.config.commandPrefix.slice(1);
  }

  protected screenshotHint(pngPath: string): string {
    return (
      `\n\nScreenshot file path: ${pngPath}\n` +
      "Use the screenshot alongside the HTML snapshot context above."
    );
  }

  protected async runAnalyzer(
    args: string[],
    logger: LoggerApi,
    stdinText?: string,
  ): Promise<ExternalCommandResult> {
    const result = await runExternalCommand(this.command, args, logger, stdinText);
    if (result.exitCode !== 0) {
      throw new Error(
        `Analyzer command failed (${[this.command, ...args].join(" ")}).\n${stripAnsi(result.stderr).trim() || stripAnsi(result.stdout).trim() || "No error output."}`,
      );
    }
    return result;
  }

  protected async runAndParse(
    args: string[],
    logger: LoggerApi,
    stdinText?: string,
  ): Promise<InterpretResult> {
    const result = await this.runAnalyzer(args, logger, stdinText);
    return parseInterpretResultFromText(result.stdout);
  }

  abstract analyzeSnapshot(
    prompt: string,
    pngPath: string,
    logger: LoggerApi,
  ): Promise<InterpretResult>;
}

class CodexUserCodingAgent extends UserCodingAgent {
  async analyzeSnapshot(
    prompt: string,
    pngPath: string,
    logger: LoggerApi,
  ): Promise<InterpretResult> {
    const tempDir = mkdtempSync(join(tmpdir(), "libretto-analyzer-"));
    const outputPath = join(
      tempDir,
      `snapshot-analyzer-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    const args = [
      ...this.baseArgs,
      "--output-last-message",
      outputPath,
      "-i",
      pngPath,
      "-",
    ];
    logger.info("interpret-analyzer-codex-start", {
      outputPath,
      pngPath,
      promptChars: prompt.length,
      args,
    });
    const result = await this.runAnalyzer(args, logger, prompt);
    let outputText = result.stdout;
    try {
      logger.info("interpret-analyzer-codex-finish", {
        outputPath,
        outputFileExists: existsSync(outputPath),
        stdoutChars: result.stdout.length,
        stderrChars: result.stderr.length,
      });
      if (existsSync(outputPath)) {
        outputText = readFileSync(outputPath, "utf-8");
      }
      return parseInterpretResultFromText(outputText);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

class ClaudeUserCodingAgent extends UserCodingAgent {
  async analyzeSnapshot(
    prompt: string,
    pngPath: string,
    logger: LoggerApi,
  ): Promise<InterpretResult> {
    return await this.runAndParse(
      [...this.baseArgs],
      logger,
      `${prompt}${this.screenshotHint(pngPath)}`,
    );
  }
}

class GeminiUserCodingAgent extends UserCodingAgent {
  async analyzeSnapshot(
    prompt: string,
    pngPath: string,
    logger: LoggerApi,
  ): Promise<InterpretResult> {
    return await this.runAndParse(
      [...this.baseArgs],
      logger,
      `${prompt}${this.screenshotHint(pngPath)}`,
    );
  }
}

async function runExternalCommand(
  command: string,
  args: string[],
  logger: LoggerApi,
  stdinText?: string,
): Promise<ExternalCommandResult> {
  return await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    logger.info("interpret-analyzer-spawn-start", {
      command,
      args,
      stdinChars: stdinText?.length ?? 0,
    });
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdinError: NodeJS.ErrnoException | null = null;

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.stdin.on("error", (err) => {
      stdinError = err as NodeJS.ErrnoException;
      logger.warn("interpret-analyzer-stdin-pipe-error", {
        command,
        args,
        code: stdinError.code ?? null,
        message: stdinError.message,
        hint:
          stdinError.code === "EPIPE"
            ? "Child process exited before consuming all stdin data"
            : "Unexpected stdin write error",
      });
    });

    child.on("error", (err) => {
      logger.error("interpret-analyzer-spawn-error", {
        command,
        args,
        error: err,
      });
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Command not found: ${command}. Configure AI with 'libretto ai configure'.`,
          ),
        );
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      const stdinNote = formatStdinError(stderr, stdinError);
      const combinedStderr = `${stderr}${stdinNote}`;
      logger.info("interpret-analyzer-spawn-close", {
        command,
        args,
        exitCode: code ?? 1,
        durationMs: Date.now() - startedAt,
        stdoutChars: stdout.length,
        stderrChars: combinedStderr.length,
        stdinErrorCode: stdinError?.code ?? null,
        stdoutPreview: summarizeForLog(stdout),
        stderrPreview: summarizeForLog(combinedStderr),
      });
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr: combinedStderr,
      });
    });

    try {
      if (stdinText !== undefined) {
        child.stdin.end(stdinText);
      } else {
        child.stdin.end();
      }
    } catch (err) {
      stdinError = err as NodeJS.ErrnoException;
      logger.warn("interpret-analyzer-stdin-write-error", {
        command,
        args,
        code: stdinError.code ?? null,
        message: stdinError.message,
        hint:
          stdinError.code === "EPIPE"
            ? "Child process exited before consuming all stdin data"
            : "Unexpected stdin write error",
      });
    }
  });
}

function stripAnsi(value: string): string {
  return value.replace(
    /\u001b\[[0-9;]*[A-Za-z]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g,
    "",
  );
}

function summarizeForLog(value: string, maxChars: number = 800): string {
  const cleaned = stripAnsi(value).trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}… [truncated ${cleaned.length - maxChars} chars]`;
}

function formatStdinError(
  stderr: string,
  error: NodeJS.ErrnoException | null,
): string {
  if (!error) return "";
  const detail =
    error.code === "EPIPE"
      ? "Analyzer closed stdin before Libretto finished sending the snapshot prompt."
      : `Analyzer stdin error: ${error.message}`;
  if (stderr.includes(detail)) return "";
  return `${stderr.endsWith("\n") || stderr.length === 0 ? "" : "\n"}${detail}\n`;
}

function extractJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  try {
    const direct = text.trim();
    if (direct.startsWith("{") && direct.endsWith("}")) {
      add(direct);
    }
  } catch {}

  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let codeBlockMatch: RegExpExecArray | null;
  while ((codeBlockMatch = codeBlockRegex.exec(text)) !== null) {
    const body = codeBlockMatch[1]?.trim();
    if (body && body.startsWith("{") && body.endsWith("}")) {
      add(body);
    }
  }

  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      add(trimmed);
    }
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) {
        add(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function collectStringLeaves(
  value: unknown,
  out: string[],
  depth: number = 0,
): void {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringLeaves(item, out, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectStringLeaves(nested, out, depth + 1);
    }
  }
}

function parseInterpretResultFromText(text: string): InterpretResult {
  const cleaned = stripAnsi(text).trim();
  const candidates = extractJsonObjectCandidates(cleaned);
  if (candidates.length === 0) {
    throw new Error(
      "Analyzer output did not include a JSON object matching the interpret schema.",
    );
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const valid = InterpretResultSchema.safeParse(parsed);
      if (valid.success) {
        return valid.data;
      }

      const nestedStrings: string[] = [];
      collectStringLeaves(parsed, nestedStrings);
      for (const nestedText of nestedStrings) {
        const nestedCandidates = extractJsonObjectCandidates(nestedText);
        for (const nestedCandidate of nestedCandidates) {
          try {
            const nestedParsed = JSON.parse(nestedCandidate);
            const nestedValid = InterpretResultSchema.safeParse(nestedParsed);
            if (nestedValid.success) {
              return nestedValid.data;
            }
          } catch {}
        }
      }
    } catch {}
  }

  throw new Error(
    "Analyzer output could not be parsed as valid interpret JSON. Ensure the configured command returns only the requested JSON object.",
  );
}

function resolvePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
}

export function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

export function readFileAsBase64(filePath: string): string {
  return readFileSync(filePath).toString("base64");
}

function truncateText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  const head = text.slice(0, Math.floor(maxChars * 0.6));
  const tail = text.slice(-Math.floor(maxChars * 0.4));
  return {
    text: `${head}\n\n... [truncated] ...\n\n${tail}`,
    truncated: true,
  };
}

function collectSelectorHints(html: string, limit = 120): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const add = (value: string) => {
    if (candidates.length >= limit || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };

  const selectors: Array<{ attr: string; format: (value: string) => string }> =
    [
      { attr: "data-testid", format: (value) => `[data-testid=\"${value}\"]` },
      { attr: "data-test", format: (value) => `[data-test=\"${value}\"]` },
      { attr: "data-qa", format: (value) => `[data-qa=\"${value}\"]` },
      { attr: "aria-label", format: (value) => `[aria-label=\"${value}\"]` },
      { attr: "role", format: (value) => `[role=\"${value}\"]` },
      { attr: "name", format: (value) => `[name=\"${value}\"]` },
      { attr: "placeholder", format: (value) => `[placeholder=\"${value}\"]` },
      { attr: "id", format: (value) => `#${value}` },
    ];

  for (const selector of selectors) {
    const regex = new RegExp(`${selector.attr}\\s*=\\s*["']([^"']+)["']`, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      const value = match[1]?.trim();
      if (!value) continue;
      add(selector.format(value));
      if (candidates.length >= limit) break;
    }
    if (candidates.length >= limit) break;
  }

  return candidates;
}

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

function inferContextWindowTokens(
  model: string,
): { contextWindowTokens: number; source: string } {
  const normalized = model.trim().toLowerCase();
  if (normalized.includes("claude")) {
    return { contextWindowTokens: 200_000, source: "model:claude" };
  }
  if (
    normalized.includes("gpt-5")
    || normalized.includes("o3")
    || normalized.includes("o4")
  ) {
    return { contextWindowTokens: 200_000, source: "model:openai" };
  }
  if (normalized.includes("gemini")) {
    return { contextWindowTokens: 1_000_000, source: "model:gemini" };
  }
  // Provider-based fallback from the provider/model-id format
  if (normalized.startsWith("openai/") || normalized.startsWith("codex/")) {
    return { contextWindowTokens: 200_000, source: "provider:openai" };
  }
  if (normalized.startsWith("anthropic/")) {
    return { contextWindowTokens: 200_000, source: "provider:anthropic" };
  }
  if (normalized.startsWith("google/") || normalized.startsWith("vertex/")) {
    return { contextWindowTokens: 1_000_000, source: "provider:google" };
  }
  // Conservative default
  return { contextWindowTokens: 128_000, source: "default" };
}

function buildSnapshotBudget(model: string): SnapshotBudget {
  const { contextWindowTokens, source } = inferContextWindowTokens(model);
  const outputReserveTokens = Math.min(
    32_000,
    Math.max(8_000, Math.floor(contextWindowTokens * 0.1)),
  );
  const promptBudgetTokens = Math.max(
    8_000,
    contextWindowTokens - outputReserveTokens - 2_000,
  );

  return {
    contextWindowTokens,
    outputReserveTokens,
    promptBudgetTokens,
    source,
  };
}

function buildInterpretInstructions(): string {
  let prompt = `# Instructions\n`;
  prompt += `You are analyzing a screenshot and HTML snapshot of the same web page on behalf of an automation agent.\n`;
  prompt += `The agent needs to interact with this page programmatically using Playwright.\n\n`;
  prompt += `Based on the objective and context above:\n`;
  prompt += `1. Answer the objective concisely\n`;
  prompt += `2. Identify ALL interactive elements relevant to the objective and provide Playwright-ready CSS selectors\n`;
  prompt += `3. Note any relevant page state (loading indicators, error messages, disabled elements, modals/overlays)\n`;
  prompt += `4. If elements are inside iframes, identify the iframe selector and the element selector within it\n\n`;
  prompt += `Output JSON with this shape:\n`;
  prompt += `{"answer": string, "selectors": [{"label": string, "selector": string, "rationale": string}], "notes": string}\n\n`;
  prompt += `Selectors should prefer robust attributes: data-testid, data-test, aria-label, name, id, role. Avoid fragile class-based or positional selectors.\n`;
  prompt += `Only include selectors that exist in the HTML snapshot.\n`;
  return prompt;
}

function buildInlineHtmlPrompt(
  args: InterpretArgs,
  options: {
    htmlContent: string;
    domLabel: "full DOM" | "condensed DOM";
    truncated: boolean;
    selectionReason: string;
    budget: SnapshotBudget;
    stats: SnapshotDomStats;
  },
): string {
  const selectorHints = collectSelectorHints(options.htmlContent, 120);

  let prompt = `# Objective\n${args.objective}\n\n`;
  prompt += `# Context\n${args.context}\n\n`;
  prompt += `# Snapshot Selection\n`;
  prompt += `- Selected HTML snapshot: ${options.domLabel}\n`;
  prompt += `- Selection reason: ${options.selectionReason}\n\n`;
  prompt += buildInterpretInstructions();

  if (selectorHints.length > 0) {
    prompt += `\nSelector hints from HTML attributes (use if relevant):\n`;
    prompt += selectorHints.map((hint) => `- ${hint}`).join("\n");
    prompt += "\n";
  }

  if (options.truncated) {
    prompt += `\nHTML content is truncated to fit token limits.\n`;
  }

  prompt += `\nHTML snapshot (${options.domLabel}):\n\n${options.htmlContent}`;
  prompt +=
    "\n\nReturn only a JSON object. Do not include markdown code fences or extra commentary.";
  return prompt;
}

export function buildInlinePromptSelection(
  args: InterpretArgs,
  fullHtmlContent: string,
  condensedHtmlContent: string,
  model: string,
): InlinePromptSelection {
  const budget = buildSnapshotBudget(model);
  const stats: SnapshotDomStats = {
    fullDomChars: fullHtmlContent.length,
    fullDomEstimatedTokens: estimateTokensFromChars(fullHtmlContent.length),
    condensedDomChars: condensedHtmlContent.length,
    condensedDomEstimatedTokens: estimateTokensFromChars(condensedHtmlContent.length),
    configuredModel: model,
  };

  const buildCandidate = (
    domSource: "full" | "condensed",
    htmlContent: string,
    selectionReason: string,
    truncated: boolean,
  ): InlinePromptSelection => {
    const domLabel = domSource === "full" ? "full DOM" : "condensed DOM";
    const prompt = buildInlineHtmlPrompt(args, {
      htmlContent,
      domLabel,
      truncated,
      selectionReason,
      budget,
      stats,
    });
    return {
      prompt,
      domSource,
      domLabel,
      htmlChars: htmlContent.length,
      htmlEstimatedTokens: estimateTokensFromChars(htmlContent.length),
      promptEstimatedTokens: estimateTokensFromChars(prompt.length),
      truncated,
      selectionReason,
      budget,
      stats,
    };
  };

  // Try full DOM first
  const fullCandidate = buildCandidate(
    "full",
    fullHtmlContent,
    "placeholder",
    false,
  );
  if (fullCandidate.promptEstimatedTokens <= budget.promptBudgetTokens) {
    const selectionReason =
      `Full DOM fits within the estimated prompt budget (~${fullCandidate.promptEstimatedTokens.toLocaleString()} <= ${budget.promptBudgetTokens.toLocaleString()} tokens), so the analyzer receives the uncondensed page HTML.`;
    const prompt = buildInlineHtmlPrompt(args, {
      htmlContent: fullHtmlContent,
      domLabel: "full DOM",
      truncated: false,
      selectionReason,
      budget,
      stats,
    });
    return {
      ...fullCandidate,
      selectionReason,
      prompt,
      promptEstimatedTokens: estimateTokensFromChars(prompt.length),
    };
  }

  // Fall back to condensed DOM
  const condensedReason = `Full DOM would exceed the estimated prompt budget (~${fullCandidate.promptEstimatedTokens.toLocaleString()} > ${budget.promptBudgetTokens.toLocaleString()} tokens), so the analyzer receives the condensed DOM instead.`;
  const condensedCandidate = buildCandidate(
    "condensed",
    condensedHtmlContent,
    condensedReason,
    false,
  );
  if (condensedCandidate.promptEstimatedTokens <= budget.promptBudgetTokens) {
    return condensedCandidate;
  }

  // Truncate condensed DOM as last resort
  const truncateReason = `Both full and condensed DOM snapshots exceed the estimated prompt budget (full ~${fullCandidate.promptEstimatedTokens.toLocaleString()}, condensed ~${condensedCandidate.promptEstimatedTokens.toLocaleString()}, budget ${budget.promptBudgetTokens.toLocaleString()} tokens), so the condensed DOM is truncated to fit.`;
  const basePrompt = buildInlineHtmlPrompt(args, {
    htmlContent: "",
    domLabel: "condensed DOM",
    truncated: true,
    selectionReason: truncateReason,
    budget,
    stats,
  });
  const availableHtmlTokens = Math.max(
    2_000,
    budget.promptBudgetTokens - estimateTokensFromChars(basePrompt.length),
  );
  const truncatedHtml = truncateText(condensedHtmlContent, availableHtmlTokens * 4);

  return buildCandidate(
    "condensed",
    truncatedHtml.text,
    truncateReason,
    truncatedHtml.truncated,
  );
}

export function formatInterpretationOutput(
  parsed: InterpretResult,
  header: string = "Interpretation:",
): string {
  const outputLines: string[] = [];
  outputLines.push(header);
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
  if (parsed.notes && parsed.notes.trim()) {
    outputLines.push("");
    outputLines.push(`Notes: ${parsed.notes.trim()}`);
  }
  return outputLines.join("\n");
}

export async function runInterpret(
  args: InterpretArgs,
  logger: LoggerApi,
): Promise<void> {
  logger.info("interpret-start", {
    objective: args.objective,
    pngPath: args.pngPath,
    htmlPath: args.htmlPath,
    condensedHtmlPath: args.condensedHtmlPath,
  });
  process.env.NODE_ENV = "development";

  const pngPath = resolvePath(args.pngPath);
  const htmlPath = resolvePath(args.htmlPath);
  const condensedHtmlPath = resolvePath(args.condensedHtmlPath);

  if (!existsSync(pngPath)) {
    throw new Error(`PNG file not found: ${pngPath}`);
  }
  if (!existsSync(htmlPath)) {
    throw new Error(`HTML file not found: ${htmlPath}`);
  }
  if (!existsSync(condensedHtmlPath)) {
    throw new Error(`Condensed HTML file not found: ${condensedHtmlPath}`);
  }

  const fullHtmlContent = readFileSync(htmlPath, "utf-8");
  const condensedHtmlContent = readFileSync(condensedHtmlPath, "utf-8");
  const configuredAgent = UserCodingAgent.getConfigured();
  if (!configuredAgent) {
    throw new Error(
      "No AI config set. Run 'npx libretto ai configure codex' (or claude/gemini), or set API credentials in your .env file for direct API analysis.",
    );
  }

  const configuredAnalyzer = configuredAgent.snapshotAnalyzerConfig;
  // Legacy CLI-agent path: requires a model string for prompt budget estimation.
  // The active config format stores model directly; if this legacy path is
  // re-enabled, the caller must supply a valid provider/model-id string.
  throw new Error(
    "The CLI-agent snapshot analysis path is not active. " +
    "Update your config to the current format with `npx libretto ai configure <provider>`, " +
    "or set API credentials in .env for direct API analysis.",
  );

  // Preserved for reference — to re-enable, remove the throw above and:
  // const selection = buildInlinePromptSelection(args, fullHtmlContent, condensedHtmlContent, model);
  // const parsed = await configuredAgent.analyzeSnapshot(selection.prompt, pngPath, logger);
  // console.log(formatInterpretationOutput(parsed));
}

export function canAnalyzeSnapshots(): boolean {
  return UserCodingAgent.getConfigured() !== null;
}
