import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { LoggerApi } from "../../shared/logger/index.js";
import {
  type AiConfig,
  formatCommandPrefix,
  readAiConfig,
} from "./ai-config.js";
import { getLLMClientFactory } from "./context.js";

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
  selectors: z
    .array(
      z.object({
        label: z.string(),
        selector: z.string(),
        rationale: z.string(),
      }),
    )
    .default([]),
  notes: z.string().optional().default(""),
  debug: z
    .object({
      consultedFiles: z.array(z.string()).optional().default([]),
      analysisSteps: z.array(z.string()).optional().default([]),
    })
    .optional(),
});

type InterpretResult = z.infer<typeof InterpretResultSchema>;

type ExternalCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CodexTraceSummary = {
  commandCount: number;
  fileCandidates: string[];
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

const FULL_DOM_CONTEXT_WINDOW_RATIO = 0.75;

abstract class UserCodingAgent {
  protected constructor(protected readonly config: AiConfig) {}

  static resolveFromConfig(config: AiConfig): UserCodingAgent {
    switch (config.preset) {
      case "codex":
        return new CodexUserCodingAgent(config);
      case "claude":
        return new ClaudeUserCodingAgent(config);
      case "gemini":
        return new GeminiUserCodingAgent(config);
    }
  }

  static readConfiguredConfig(): AiConfig | null {
    return readAiConfig();
  }

  static getConfigured(): UserCodingAgent | null {
    const config = this.readConfiguredConfig();
    return config ? this.resolveFromConfig(config) : null;
  }

  get snapshotAnalyzerConfig(): AiConfig {
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

  /** Build extra CLI args from config.model, config.reasoning, config.allowedTools. */
  protected abstract buildExtraArgs(): string[];

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
    const result = await runExternalCommand(
      this.command,
      args,
      logger,
      stdinText,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `Analyzer command failed (${formatCommandPrefix([this.command, ...args])}).\n${stripAnsi(result.stderr).trim() || stripAnsi(result.stdout).trim() || "No error output."}`,
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
  protected buildExtraArgs(): string[] {
    const extra: string[] = [];
    if (this.config.model) {
      extra.push("--model", this.config.model);
    }
    // Codex tool restriction is handled via --sandbox in commandPrefix.
    // Snapshot analysis does not currently set Codex reasoning effort.
    return extra;
  }

  async analyzeSnapshot(
    prompt: string,
    pngPath: string,
    logger: LoggerApi,
  ): Promise<InterpretResult> {
    const tempDir = mkdtempSync(join(tmpdir(), "libretto-cli-analyzer-"));
    const outputPath = join(
      tempDir,
      `snapshot-analyzer-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    const args = [
      ...this.baseArgs,
      ...this.buildExtraArgs(),
      "--json",
      "--output-last-message",
      outputPath,
      "--image",
      pngPath,
      "-",
    ];
    logger.info("interpret-analyzer-codex-start", {
      outputPath,
      pngPath,
      promptChars: prompt.length,
      command: this.command,
      args,
    });
    const result = await this.runAnalyzer(args, logger, prompt);
    const trace = logCodexJsonTrace(result.stdout, logger);
    let outputText = result.stdout;
    try {
      const outputFileExists = existsSync(outputPath);
      logger.info("interpret-analyzer-codex-finish", {
        outputPath,
        outputFileExists,
        stdoutChars: result.stdout.length,
        stderrChars: result.stderr.length,
        traceCommandCount: trace.commandCount,
        traceFileCandidates: trace.fileCandidates,
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
  protected buildExtraArgs(): string[] {
    const extra: string[] = [];
    if (this.config.model) {
      extra.push("--model", this.config.model);
    }
    if (this.config.reasoning !== undefined) {
      // Current Claude CLI exposes effort levels, not numeric thinking budgets.
      if (typeof this.config.reasoning === "string") {
        extra.push("--effort", this.config.reasoning);
      }
    }
    if (this.config.allowedTools?.length) {
      // Claude uses --tools "Read,Grep,Glob" to restrict available tools
      extra.push("--tools", this.config.allowedTools.join(","));
    }
    extra.push("--permission-mode", "bypassPermissions");
    return extra;
  }

  async analyzeSnapshot(
    prompt: string,
    pngPath: string,
    logger: LoggerApi,
  ): Promise<InterpretResult> {
    const args = [
      ...this.baseArgs,
      ...this.buildExtraArgs(),
      "--verbose",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
    ];
    return await this.runAndParse(args, logger, buildClaudeStreamJsonInput(prompt, pngPath));
  }
}

class GeminiUserCodingAgent extends UserCodingAgent {
  protected buildExtraArgs(): string[] {
    const extra: string[] = [];
    if (this.config.model) {
      extra.push("--model", this.config.model);
    }
    if (this.config.allowedTools?.length) {
      // Gemini uses --allowed-tools "read_file,list_directory,search_file_content,glob"
      extra.push("--allowed-tools", this.config.allowedTools.join(","));
    }
    return extra;
  }

  async analyzeSnapshot(
    prompt: string,
    pngPath: string,
    logger: LoggerApi,
  ): Promise<InterpretResult> {
    const args = [
      ...this.baseArgs,
      ...this.buildExtraArgs(),
    ];
    return await this.runAndParse(
      args,
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

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      logger.error("interpret-analyzer-spawn-error", {
        error: err,
        command,
        args,
      });
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Command not found: ${command}. Configure AI with 'libretto-cli ai configure'.`,
          ),
        );
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      logger.info("interpret-analyzer-spawn-close", {
        command,
        args,
        exitCode: code ?? 1,
        durationMs: Date.now() - startedAt,
        stdoutChars: stdout.length,
        stderrChars: stderr.length,
        stdoutPreview: summarizeForLog(stdout),
        stderrPreview: summarizeForLog(stderr),
      });
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    child.stdin.on("error", (err) => {
      const errno = err as NodeJS.ErrnoException;
      logger.warn("interpret-analyzer-stdin-pipe-error", {
        command,
        args,
        code: errno.code ?? null,
        message: err.message,
        hint:
          errno.code === "EPIPE"
            ? "Child process exited before consuming all stdin data"
            : "Unexpected stdin write error",
      });
    });

    if (stdinText !== undefined) {
      child.stdin.write(stdinText);
    }
    child.stdin.end();
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

function extractShellSnippet(command: string): string {
  const dqMatch = command.match(/-lc\s+"([\s\S]*)"$/);
  if (dqMatch?.[1]) {
    return dqMatch[1];
  }
  const sqMatch = command.match(/-lc\s+'([\s\S]*)'$/);
  if (sqMatch?.[1]) {
    return sqMatch[1];
  }
  return command;
}

function extractPathCandidatesFromCommand(command: string): string[] {
  const snippet = extractShellSnippet(command);
  const candidates = new Set<string>();
  const add = (value: string) => {
    const cleaned = value.replace(/^[("'`]+|[)"'`;,:]+$/g, "");
    if (!cleaned) return;
    if (cleaned.startsWith("-")) return;
    if (cleaned === "." || cleaned === "..") return;
    candidates.add(cleaned);
  };

  const pathWithSlashRegex =
    /(?:^|[\s("'`])((?:\/|\.{1,2}\/)[^\s"'`;)]+|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)/g;
  let match: RegExpExecArray | null;
  while ((match = pathWithSlashRegex.exec(snippet)) !== null) {
    if (match[1]) add(match[1]);
  }

  const fileRegex =
    /(?:^|[\s("'`])([A-Za-z0-9_.-]+\.(?:html?|png|json|txt|md|ts|tsx|js|mjs|cjs|css|svg))/gi;
  while ((match = fileRegex.exec(snippet)) !== null) {
    if (match[1]) add(match[1]);
  }

  return Array.from(candidates);
}

function logCodexJsonTrace(
  stdout: string,
  logger: LoggerApi,
): CodexTraceSummary {
  let commandCount = 0;
  const fileCandidates = new Set<string>();

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        type?: string;
        item?: {
          type?: string;
          command?: string;
          aggregated_output?: string;
          exit_code?: number | null;
          status?: string;
          text?: string;
        };
      };

      if (
        parsed.type === "item.completed" &&
        parsed.item?.type === "command_execution"
      ) {
        commandCount += 1;
        const command = parsed.item.command ?? "";
        const paths = extractPathCandidatesFromCommand(command);
        for (const path of paths) fileCandidates.add(path);
        logger.info("interpret-analyzer-codex-command", {
          command,
          status: parsed.item.status ?? null,
          exitCode: parsed.item.exit_code ?? null,
          paths,
          outputPreview: summarizeForLog(
            parsed.item.aggregated_output ?? "",
            300,
          ),
        });
        continue;
      }

      if (
        parsed.type === "item.completed" &&
        parsed.item?.type === "agent_message"
      ) {
        logger.info("interpret-analyzer-codex-message", {
          textPreview: summarizeForLog(parsed.item.text ?? "", 240),
        });
      }
    } catch {}
  }

  const summary = {
    commandCount,
    fileCandidates: Array.from(fileCandidates),
  };
  logger.info("interpret-analyzer-codex-trace-summary", summary);
  return summary;
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
  prompt += `{"answer": string, "selectors": [{"label": string, "selector": string, "rationale": string}], "notes": string, "debug"?: {"consultedFiles": string[], "analysisSteps": string[]}}\n\n`;
  prompt += `Selectors must be human-readable and use the minimum chain needed to uniquely identify the element. Prefer semantic attributes (data-testid, data-test, aria-label, name, id, role, href patterns) over bare tag or class selectors. Use descendant selectors (space) to skip intermediate elements that have no meaningful attributes — only use direct child selectors (>) when the direct parent-child relationship is semantically important.\n`;
  prompt += `Only include selectors that exist in the HTML snapshot.\n`;
  prompt += `For each selector, explain its nesting context in the rationale. Start from the target element itself — note what makes it identifiable, then mention the nearest stable ancestor only if needed to disambiguate.\n`;
  prompt += `When possible, include debug.consultedFiles with the snapshot inputs you actually used (for example inline:screenshot, inline:full-dom, inline:condensed-dom) and debug.analysisSteps with 2-5 short steps describing how you found the answer.\n`;
  return prompt;
}

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

function inferContextWindowTokens(
  config: AiConfig,
): { contextWindowTokens: number; source: string } {
  const model = config.model?.trim().toLowerCase();
  if (model) {
    if (model.includes("claude")) {
      return { contextWindowTokens: 200_000, source: "model:claude" };
    }
    if (
      model.includes("gpt-5")
      || model.includes("o3")
      || model.includes("o4")
      || model.includes("codex")
    ) {
      return { contextWindowTokens: 200_000, source: "model:openai" };
    }
    if (model.includes("gemini")) {
      return { contextWindowTokens: 1_000_000, source: "model:gemini" };
    }
  }

  switch (config.preset) {
    case "claude":
      return { contextWindowTokens: 200_000, source: "preset:claude" };
    case "codex":
      return { contextWindowTokens: 200_000, source: "preset:codex" };
    case "gemini":
      return { contextWindowTokens: 1_000_000, source: "preset:gemini" };
  }
}

function buildSnapshotBudget(config: AiConfig): SnapshotBudget {
  const { contextWindowTokens, source } = inferContextWindowTokens(config);
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

function buildSnapshotDomStats(
  fullHtmlContent: string,
  condensedHtmlContent: string,
  config: AiConfig,
): SnapshotDomStats {
  const fullDomChars = fullHtmlContent.length;
  const condensedDomChars = condensedHtmlContent.length;
  const fullDomEstimatedTokens = estimateTokensFromChars(fullDomChars);
  const condensedDomEstimatedTokens = estimateTokensFromChars(condensedDomChars);

  return {
    fullDomChars,
    fullDomEstimatedTokens,
    condensedDomChars,
    condensedDomEstimatedTokens,
    configuredModel: config.model ?? config.preset,
  };
}

function getFullDomSelectionThresholdTokens(budget: SnapshotBudget): number {
  return Math.floor(budget.contextWindowTokens * FULL_DOM_CONTEXT_WINDOW_RATIO);
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
  prompt += `- Configured model: ${options.stats.configuredModel}\n`;
  prompt += `- Estimated context window: ${options.budget.contextWindowTokens.toLocaleString()} tokens (${options.budget.source})\n`;
  prompt += `- Reserved output budget: ${options.budget.outputReserveTokens.toLocaleString()} tokens\n`;
  prompt += `- Estimated prompt budget: ${options.budget.promptBudgetTokens.toLocaleString()} tokens\n`;
  prompt += `- Full DOM size: ${options.stats.fullDomChars.toLocaleString()} chars (~${options.stats.fullDomEstimatedTokens.toLocaleString()} tokens)\n`;
  prompt += `- Condensed DOM size: ${options.stats.condensedDomChars.toLocaleString()} chars (~${options.stats.condensedDomEstimatedTokens.toLocaleString()} tokens)\n`;
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
  config: AiConfig,
): InlinePromptSelection {
  const budget = buildSnapshotBudget(config);
  const stats = buildSnapshotDomStats(
    fullHtmlContent,
    condensedHtmlContent,
    config,
  );

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

  const fullDomSelectionThresholdTokens = getFullDomSelectionThresholdTokens(budget);
  const selectedDomSource =
    stats.fullDomEstimatedTokens > fullDomSelectionThresholdTokens
      ? "condensed"
      : "full";
  const selectedHtmlContent =
    selectedDomSource === "full" ? fullHtmlContent : condensedHtmlContent;
  const selectedDomReason =
    selectedDomSource === "full"
      ? `Full DOM is within 75% of the estimated context window (${stats.fullDomEstimatedTokens.toLocaleString()} <= ${fullDomSelectionThresholdTokens.toLocaleString()} tokens), so the analyzer receives the uncondensed page HTML.`
      : `Full DOM exceeds 75% of the estimated context window (${stats.fullDomEstimatedTokens.toLocaleString()} > ${fullDomSelectionThresholdTokens.toLocaleString()} tokens), so the analyzer receives the condensed DOM instead.`;

  const selectedCandidate = buildCandidate(
    selectedDomSource,
    selectedHtmlContent,
    selectedDomReason,
    false,
  );
  if (selectedCandidate.promptEstimatedTokens <= budget.promptBudgetTokens) {
    return selectedCandidate;
  }

  const basePrompt = buildInlineHtmlPrompt(args, {
    htmlContent: "",
    domLabel: selectedCandidate.domLabel,
    truncated: true,
    selectionReason:
      `${selectedDomReason} The selected HTML snapshot still exceeds the estimated prompt budget, so it is truncated to fit.`,
    budget,
    stats,
  });
  const availableHtmlTokens = Math.max(
    2_000,
    budget.promptBudgetTokens - estimateTokensFromChars(basePrompt.length),
  );
  const truncatedHtml = truncateText(selectedHtmlContent, availableHtmlTokens * 4);

  return buildCandidate(
    selectedDomSource,
    truncatedHtml.text,
    `${selectedDomReason} The selected HTML snapshot still exceeds the estimated prompt budget, so it is truncated to fit.`,
    truncatedHtml.truncated,
  );
}

function buildClaudeStreamJsonInput(prompt: string, pngPath: string): string {
  const imageBase64 = readFileAsBase64(pngPath);
  return `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: getMimeType(pngPath),
            data: imageBase64,
          },
        },
      ],
    },
  })}\n`;
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

  let parsed: InterpretResult;
  const fullHtmlContent = readFileSync(htmlPath, "utf-8");
  const condensedHtmlContent = readFileSync(condensedHtmlPath, "utf-8");
  const configuredAgent = UserCodingAgent.getConfigured();
  if (configuredAgent) {
    const configuredAnalyzer = configuredAgent.snapshotAnalyzerConfig;
    const selection = buildInlinePromptSelection(
      args,
      fullHtmlContent,
      condensedHtmlContent,
      configuredAnalyzer,
    );
    logger.info("interpret-analyzer-config", {
      preset: configuredAnalyzer.preset,
      commandPrefix: configuredAnalyzer.commandPrefix,
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
    parsed = await configuredAgent.analyzeSnapshot(
      selection.prompt,
      pngPath,
      logger,
    );
  } else {
    const llmClientFactory = getLLMClientFactory();
    if (!llmClientFactory) {
      throw new Error(
        "No AI config set. Run 'libretto-cli ai configure codex' (or claude/gemini). Library integrations can still set a factory via setLLMClientFactory().",
      );
    }

    logger.info("interpret-analyzer-factory-fallback", {});
    const fallbackConfig: AiConfig = {
      preset: "gemini",
      commandPrefix: ["gemini"],
      updatedAt: new Date(0).toISOString(),
    };
    const selection = buildInlinePromptSelection(
      args,
      fullHtmlContent,
      condensedHtmlContent,
      fallbackConfig,
    );
    const imageBase64 = readFileAsBase64(pngPath);
    const client = await llmClientFactory(
      logger,
      "google/gemini-3-flash-preview",
    );
    const result = await client.generateObjectFromMessages({
      schema: InterpretResultSchema,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: selection.prompt },
            {
              type: "image",
              image: `data:${getMimeType(pngPath)};base64,${imageBase64}`,
            },
          ],
        },
      ],
      temperature: 0.1,
    });
    parsed = InterpretResultSchema.parse(result);
  }

  logger.info("interpret-success", {
    selectorCount: parsed.selectors.length,
    answer: parsed.answer.slice(0, 200),
    consultedFiles: parsed.debug?.consultedFiles ?? [],
  });
  const outputLines: string[] = [];
  outputLines.push("Interpretation:");
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

export function canAnalyzeSnapshots(): boolean {
  return (
    UserCodingAgent.getConfigured() !== null || getLLMClientFactory() !== null
  );
}
