import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { type AiConfig, readAiConfig, runAiConfigure } from "./ai-config";
import {
  getLLMClientFactory,
  getLog,
  STATE_DIR,
} from "./context";
import { getRunDir, getSessionStateOrThrow } from "./session";

export type ScreenshotPair = {
  pngPath: string;
  htmlPath: string;
  baseName: string;
};

export type InterpretArgs = {
  objective: string;
  session: string;
  context: string;
  pngPath?: string;
  htmlPath?: string;
};

const InterpretResultSchema = z.object({
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
});

type InterpretResult = z.infer<typeof InterpretResultSchema>;

type ExternalCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function quoteShellArg(value: string): string {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function formatCommandPrefix(prefix: string[]): string {
  return prefix.map((arg) => quoteShellArg(arg)).join(" ");
}

abstract class UserCodingAgent {
  protected constructor(protected readonly config: AiConfig) {}

  static resolveFromConfig(config: AiConfig): UserCodingAgent {
    switch (config.preset) {
      case "codex":
        return new CodexUserCodingAgent(config);
      case "opencode":
        return new OpencodeUserCodingAgent(config);
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

  protected screenshotHint(pngPath: string): string {
    return (
      `\n\nScreenshot file path: ${pngPath}\n` +
      "Use the screenshot alongside the HTML snapshot context above."
    );
  }

  protected async runAnalyzer(
    args: string[],
    stdinText?: string,
  ): Promise<ExternalCommandResult> {
    const result = await runExternalCommand(this.command, args, stdinText);
    if (result.exitCode !== 0) {
      throw new Error(
        `Analyzer command failed (${formatCommandPrefix([this.command, ...args])}).\n${stripAnsi(result.stderr).trim() || stripAnsi(result.stdout).trim() || "No error output."}`,
      );
    }
    return result;
  }

  protected async runAndParse(
    args: string[],
    stdinText?: string,
  ): Promise<InterpretResult> {
    const result = await this.runAnalyzer(args, stdinText);
    return parseInterpretResultFromText(result.stdout);
  }

  abstract analyzeSnapshot(
    prompt: string,
    pngPath: string,
  ): Promise<InterpretResult>;
}

class CodexUserCodingAgent extends UserCodingAgent {
  async analyzeSnapshot(
    prompt: string,
    pngPath: string,
  ): Promise<InterpretResult> {
    mkdirSync(STATE_DIR, { recursive: true });
    const outputPath = join(
      STATE_DIR,
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
    const result = await this.runAnalyzer(args, prompt);
    let outputText = result.stdout;
    try {
      if (existsSync(outputPath)) {
        outputText = readFileSync(outputPath, "utf-8");
      }
      return parseInterpretResultFromText(outputText);
    } finally {
      if (existsSync(outputPath)) {
        unlinkSync(outputPath);
      }
    }
  }
}

class OpencodeUserCodingAgent extends UserCodingAgent {
  async analyzeSnapshot(
    prompt: string,
    pngPath: string,
  ): Promise<InterpretResult> {
    const args = [
      ...this.baseArgs,
      `${prompt}${this.screenshotHint(pngPath)}`,
      "-f",
      pngPath,
    ];
    return await this.runAndParse(args);
  }
}

class ClaudeUserCodingAgent extends UserCodingAgent {
  async analyzeSnapshot(
    prompt: string,
    pngPath: string,
  ): Promise<InterpretResult> {
    const args = [...this.baseArgs, `${prompt}${this.screenshotHint(pngPath)}`];
    return await this.runAndParse(args);
  }
}

class GeminiUserCodingAgent extends UserCodingAgent {
  async analyzeSnapshot(
    prompt: string,
    pngPath: string,
  ): Promise<InterpretResult> {
    const args = [...this.baseArgs, `${prompt}${this.screenshotHint(pngPath)}`];
    return await this.runAndParse(args);
  }
}

async function runExternalCommand(
  command: string,
  args: string[],
  stdinText?: string,
): Promise<ExternalCommandResult> {
  return await new Promise((resolve, reject) => {
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
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
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

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function readFileAsBase64(filePath: string): string {
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

function findLatestScreenshotPair(screenshotsDir: string): ScreenshotPair {
  if (!existsSync(screenshotsDir)) {
    throw new Error(
      `No snapshots directory found: ${screenshotsDir}. Run 'libretto-cli snapshot' first.`,
    );
  }

  const entries = readdirSync(screenshotsDir, { withFileTypes: true });
  const pairs = new Map<
    string,
    { pngPath?: string; htmlPath?: string; mtimeMs: number }
  >();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name);
    if (ext !== ".png" && ext !== ".html") continue;
    const baseName = basename(entry.name, ext);
    const fullPath = join(screenshotsDir, entry.name);
    const stat = statSync(fullPath);
    const current = pairs.get(baseName) || { mtimeMs: 0 };
    const next = {
      ...current,
      mtimeMs: Math.max(current.mtimeMs, stat.mtimeMs),
    };
    if (ext === ".png") next.pngPath = fullPath;
    if (ext === ".html") next.htmlPath = fullPath;
    pairs.set(baseName, next);
  }

  let latestBaseName: string | null = null;
  let latestPngPath: string | null = null;
  let latestHtmlPath: string | null = null;
  let latestMtime = 0;

  pairs.forEach((pair, baseName) => {
    if (!pair.pngPath || !pair.htmlPath) return;
    if (!latestBaseName || pair.mtimeMs > latestMtime) {
      latestBaseName = baseName;
      latestPngPath = pair.pngPath;
      latestHtmlPath = pair.htmlPath;
      latestMtime = pair.mtimeMs;
    }
  });

  if (!latestBaseName || !latestPngPath || !latestHtmlPath) {
    throw new Error(
      `No snapshot + HTML pair found in ${screenshotsDir}. Run 'libretto-cli snapshot' first.`,
    );
  }

  return {
    baseName: latestBaseName,
    pngPath: latestPngPath,
    htmlPath: latestHtmlPath,
  };
}

function resolveScreenshotPair(
  session: string,
  pngPath?: string,
  htmlPath?: string,
): ScreenshotPair {
  const state = getSessionStateOrThrow(session);
  const runDir = getRunDir(state.runId);
  let resolvedPng = pngPath ? resolvePath(pngPath) : undefined;
  let resolvedHtml = htmlPath ? resolvePath(htmlPath) : undefined;

  if (resolvedPng && !existsSync(resolvedPng)) {
    throw new Error(`PNG file not found: ${resolvedPng}`);
  }
  if (resolvedHtml && !existsSync(resolvedHtml)) {
    throw new Error(`HTML file not found: ${resolvedHtml}`);
  }

  if (resolvedPng && !resolvedHtml) {
    const candidate = resolvedPng.replace(/\.[^.]+$/, ".html");
    if (existsSync(candidate)) {
      resolvedHtml = candidate;
    }
  }

  if (resolvedHtml && !resolvedPng) {
    const candidate = resolvedHtml.replace(/\.[^.]+$/, ".png");
    if (existsSync(candidate)) {
      resolvedPng = candidate;
    }
  }

  if (!resolvedPng || !resolvedHtml) {
    if (!resolvedPng && !resolvedHtml) {
      return findLatestScreenshotPair(runDir);
    }
    throw new Error(
      "Both PNG and HTML paths are required if one is provided (or ensure matching .png/.html exists).",
    );
  }

  return {
    baseName: basename(resolvedPng, extname(resolvedPng)),
    pngPath: resolvedPng,
    htmlPath: resolvedHtml,
  };
}

export function runSnapshotConfigure(input: {
  preset?: string;
  clear?: boolean;
  customPrefix?: string[];
}): void {
  runAiConfigure(input, {
    configureCommandName: "libretto-cli ai configure",
  });
}

export async function runInterpret(args: InterpretArgs): Promise<void> {
  const log = getLog();
  log.info("interpret-start", {
    objective: args.objective,
    pngPath: args.pngPath,
    htmlPath: args.htmlPath,
  });
  process.env.NODE_ENV = "development";

  const { pngPath, htmlPath } = resolveScreenshotPair(
    args.session,
    args.pngPath,
    args.htmlPath,
  );
  const htmlContent = readFileSync(htmlPath, "utf-8");
  const htmlCharLimit = 500_000;
  const { text: trimmedHtml, truncated } = truncateText(
    htmlContent,
    htmlCharLimit,
  );
  const selectorHints = collectSelectorHints(htmlContent, 120);

  let prompt = `# Objective\n${args.objective}\n\n`;
  prompt += `# Context\n${args.context}\n\n`;
  prompt += `# Instructions\n`;
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
  prompt += `Only include selectors that exist in the HTML snapshot.\n\n`;

  if (selectorHints.length > 0) {
    prompt += `Selector hints from HTML attributes (use if relevant):\n`;
    prompt += selectorHints.map((hint) => `- ${hint}`).join("\n");
    prompt += "\n\n";
  }

  if (truncated) {
    prompt += `HTML content is truncated to fit token limits.\n\n`;
  }

  prompt += `HTML snapshot:\n\n${trimmedHtml}`;
  prompt +=
    "\n\nReturn only a JSON object. Do not include markdown code fences or extra commentary.";

  let parsed: InterpretResult;
  const configuredAgent = UserCodingAgent.getConfigured();
  if (configuredAgent) {
    const configuredAnalyzer = configuredAgent.snapshotAnalyzerConfig;
    log.info("interpret-analyzer-config", {
      preset: configuredAnalyzer.preset,
      commandPrefix: configuredAnalyzer.commandPrefix,
    });
    parsed = await configuredAgent.analyzeSnapshot(prompt, pngPath);
  } else {
    const llmClientFactory = getLLMClientFactory();
    if (!llmClientFactory) {
      throw new Error(
        "No AI config set. Run 'libretto-cli ai configure codex' (or opencode/claude/gemini). Library integrations can still set a factory via setLLMClientFactory().",
      );
    }

    log.info("interpret-analyzer-factory-fallback", {});
    const imageBase64 = readFileAsBase64(pngPath);
    const client = await llmClientFactory(log, "google/gemini-3-flash-preview");
    const result = await client.generateObjectFromMessages({
      schema: InterpretResultSchema,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
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

  log.info("interpret-success", {
    selectorCount: parsed.selectors.length,
    answer: parsed.answer.slice(0, 200),
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

  console.log(outputLines.join("\n"));
}

export function canAnalyzeSnapshots(): boolean {
  return UserCodingAgent.getConfigured() !== null || getLLMClientFactory() !== null;
}
