import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { Logger } from "../src/logger/logger.js";
import { createFileLogSink } from "../src/logger/sinks.js";
import type { LLMClient } from "../src/llm/types.js";
import { installInstrumentation } from "../src/instrumentation/instrument.js";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  unlinkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  renameSync,
  writeFileSync,
  openSync,
  appendFileSync,
} from "node:fs";
import { basename, extname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { cwd } from "node:process";
import { createServer } from "node:net";
import { z } from "zod";
import {
  launchJob,
  getJobStatus,
  stopJob,
  waitForPause,
  resumeJob,
} from "../src/run/launcher.js";
import type { LaunchConfig } from "../src/run/types.js";

// ── LLM client factory ─────────────────────────────────────────────────
// Users must call setLLMClientFactory() before using snapshot/interpret commands.
let llmClientFactory:
  | ((logger: Logger, model: string) => Promise<LLMClient>)
  | null = null;

export function setLLMClientFactory(
  factory: (logger: Logger, model: string) => Promise<LLMClient>,
): void {
  llmClientFactory = factory;
}

// ── File logger for debugging ───────────────────────────────────────────
// All logs (CLI parent + child process) go to a single file per run:
//   tmp/libretto-cli/<runId>/session.log

function generateRunId(): string {
  return new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..+/, "")
    .replace(/^(\d{8})(\d{6})$/, "$1-$2");
}

function getRunDir(runId: string): string {
  return join(STATE_DIR, runId);
}

function logFileForRun(runId: string): string {
  const dir = getRunDir(runId);
  mkdirSync(dir, { recursive: true });
  return join(dir, "session.log");
}

// Initialized in runLibrettoCLI() with the session-specific log file.
// ensureLog() lazily creates a fallback logger for exported functions
// (like runClose) that can be called without going through runLibrettoCLI().
let log!: Logger;

function ensureLog(): void {
  if (log) return;
  mkdirSync(STATE_DIR, { recursive: true });
  log = new Logger(
    ["libretto-cli"],
    [createFileLogSink({ filePath: join(STATE_DIR, "cli.log") })],
  );
}

function getRepoRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  });
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return cwd();
}

const REPO_ROOT = getRepoRoot();
const STATE_DIR = join(REPO_ROOT, "tmp", "libretto-cli");
const LIBRETTO_DIR = join(REPO_ROOT, ".libretto-cli");
const PROFILES_DIR = join(REPO_ROOT, ".libretto-cli", "profiles");
const SNAPSHOT_ANALYZER_CONFIG_PATH = join(
  LIBRETTO_DIR,
  "snapshot-config.json",
);

// Migrate legacy .playwriter profiles to .libretto-cli
const LEGACY_PROFILES_DIR = join(REPO_ROOT, ".playwriter", "profiles");
if (existsSync(LEGACY_PROFILES_DIR) && !existsSync(PROFILES_DIR)) {
  mkdirSync(join(REPO_ROOT, ".libretto-cli"), { recursive: true });
  renameSync(LEGACY_PROFILES_DIR, PROFILES_DIR);
}

// Migrate legacy .browser-tap profiles to .libretto-cli
const LEGACY_BT_PROFILES_DIR = join(REPO_ROOT, ".browser-tap", "profiles");
if (existsSync(LEGACY_BT_PROFILES_DIR) && !existsSync(PROFILES_DIR)) {
  mkdirSync(join(REPO_ROOT, ".libretto-cli"), { recursive: true });
  renameSync(LEGACY_BT_PROFILES_DIR, PROFILES_DIR);
}

const SESSION_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export const SESSION_DEFAULT = "default";
export const SESSION_DEV_SERVER = "dev-server";
export const SESSION_BROWSER_AGENT = "browser-agent";

type SessionState = {
  port: number;
  pid: number;
  session: string;
  runId: string;
  startedAt: string;
};

type ScreenshotPair = {
  pngPath: string;
  htmlPath: string;
  baseName: string;
};

type InterpretArgs = {
  objective: string;
  session: string;
  context: string;
  pngPath?: string;
  htmlPath?: string;
};

const SnapshotAnalyzerPresetSchema = z.enum(["codex", "opencode", "claude"]);
type SnapshotAnalyzerPreset = z.infer<typeof SnapshotAnalyzerPresetSchema>;

const SnapshotAnalyzerConfigSchema = z.object({
  version: z.literal(1),
  preset: SnapshotAnalyzerPresetSchema,
  commandPrefix: z.array(z.string()).min(1),
  updatedAt: z.string(),
});

type SnapshotAnalyzerConfig = z.infer<typeof SnapshotAnalyzerConfigSchema>;

const SNAPSHOT_ANALYZER_PRESETS: Record<SnapshotAnalyzerPreset, string[]> = {
  codex: ["codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only"],
  opencode: ["opencode", "run", "--format", "json"],
  claude: [join(homedir(), ".claude", "local", "claude"), "-p"],
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

function validateSessionName(session: string): void {
  if (
    !SESSION_NAME_PATTERN.test(session) ||
    session.includes("..") ||
    session.includes("/") ||
    session.includes("\\")
  ) {
    throw new Error(
      "Invalid session name. Use only letters, numbers, dots, underscores, and dashes.",
    );
  }
}

function getStateFilePath(session: string): string {
  validateSessionName(session);
  mkdirSync(STATE_DIR, { recursive: true });
  return join(STATE_DIR, `${session}.json`);
}

function readSessionState(session: string): SessionState | null {
  ensureLog();
  const stateFile = getStateFilePath(session);
  if (!existsSync(stateFile)) {
    log.info("session-state-not-found", { session, stateFile });
    return null;
  }
  try {
    const content = readFileSync(stateFile, "utf-8");
    const state = JSON.parse(content) as SessionState;
    log.info("session-state-read", {
      session,
      port: state.port,
      pid: state.pid,
    });
    return state;
  } catch (err) {
    log.warn("session-state-parse-error", { error: err, session, stateFile });
    return null;
  }
}

function listActiveSessions(): string[] {
  if (!existsSync(STATE_DIR)) return [];
  return readdirSync(STATE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function getSessionStateOrThrow(session: string): SessionState {
  const stateFile = getStateFilePath(session);
  if (!existsSync(stateFile)) {
    const active = listActiveSessions();
    const lines = [`No session "${session}" found.`];
    if (active.length > 0) {
      lines.push("");
      lines.push("Active sessions:");
      for (const name of active) {
        lines.push(`  ${name}`);
      }
      lines.push("");
      lines.push("Run commands against a session with:");
      lines.push(`  libretto-cli exec "<code>" --session <name>`);
    } else {
      lines.push("");
      lines.push("No active sessions. Start one with:");
      lines.push(
        "  libretto-cli open <url>                # standalone browser",
      );
    }
    throw new Error(lines.join("\n"));
  }

  try {
    const content = readFileSync(stateFile, "utf-8");
    return JSON.parse(content) as SessionState;
  } catch {
    throw new Error(
      `Session state at ${stateFile} could not be parsed. Delete the file and retry.`,
    );
  }
}

function writeSessionState(state: SessionState): void {
  ensureLog();
  const stateFile = getStateFilePath(state.session);
  log.info("session-state-write", {
    session: state.session,
    port: state.port,
    pid: state.pid,
    stateFile,
  });
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function clearSessionState(session: string): void {
  ensureLog();
  const stateFile = getStateFilePath(session);
  if (existsSync(stateFile)) {
    log.info("session-state-clear", { session, stateFile });
    unlinkSync(stateFile);
  }
}

async function pickFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        server.close(() => resolve(addr.port));
      } else {
        server.close(() => reject(new Error("Failed to get port")));
      }
    });
  });
}

function normalizeUrl(url: string): string {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return `https://${url}`;
  }
  return url;
}

function normalizeDomain(url: string): string {
  try {
    const parsed = new URL(normalizeUrl(url));
    let domain = parsed.hostname;
    if (domain.startsWith("www.")) {
      domain = domain.slice(4);
    }
    return domain;
  } catch {
    return url;
  }
}

function getProfilePath(domain: string): string {
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
  return join(PROFILES_DIR, `${domain}.json`);
}

function resolvePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(cwd(), filePath);
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
      { attr: "data-testid", format: (value) => `[data-testid="${value}"]` },
      { attr: "data-test", format: (value) => `[data-test="${value}"]` },
      { attr: "data-qa", format: (value) => `[data-qa="${value}"]` },
      { attr: "aria-label", format: (value) => `[aria-label="${value}"]` },
      { attr: "role", format: (value) => `[role="${value}"]` },
      { attr: "name", format: (value) => `[name="${value}"]` },
      { attr: "placeholder", format: (value) => `[placeholder="${value}"]` },
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

function ensureLibrettoDir(): void {
  mkdirSync(LIBRETTO_DIR, { recursive: true });
}

function quoteShellArg(value: string): string {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function formatCommandPrefix(prefix: string[]): string {
  return prefix.map((arg) => quoteShellArg(arg)).join(" ");
}

abstract class UserCodingAgent {
  protected constructor(protected readonly config: SnapshotAnalyzerConfig) {}

  static resolveFromConfig(config: SnapshotAnalyzerConfig): UserCodingAgent {
    switch (config.preset) {
      case "codex":
        return new CodexUserCodingAgent(config);
      case "opencode":
        return new OpencodeUserCodingAgent(config);
      case "claude":
        return new ClaudeUserCodingAgent(config);
    }
  }

  static readConfiguredConfig(): SnapshotAnalyzerConfig | null {
    if (!existsSync(SNAPSHOT_ANALYZER_CONFIG_PATH)) return null;
    try {
      const raw = readFileSync(SNAPSHOT_ANALYZER_CONFIG_PATH, "utf-8");
      return SnapshotAnalyzerConfigSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error(
        `Snapshot analyzer config is invalid at ${SNAPSHOT_ANALYZER_CONFIG_PATH}. Delete it or run 'libretto-cli snapshot configure --clear'.`,
      );
    }
  }

  static getConfigured(): UserCodingAgent | null {
    const config = this.readConfiguredConfig();
    return config ? this.resolveFromConfig(config) : null;
  }

  static writeConfig(
    preset: SnapshotAnalyzerPreset,
    commandPrefix: string[],
  ): SnapshotAnalyzerConfig {
    ensureLibrettoDir();
    const config = SnapshotAnalyzerConfigSchema.parse({
      version: 1,
      preset,
      commandPrefix,
      updatedAt: new Date().toISOString(),
    });
    writeFileSync(
      SNAPSHOT_ANALYZER_CONFIG_PATH,
      JSON.stringify(config, null, 2),
      "utf-8",
    );
    return config;
  }

  static clearConfig(): boolean {
    if (!existsSync(SNAPSHOT_ANALYZER_CONFIG_PATH)) return false;
    unlinkSync(SNAPSHOT_ANALYZER_CONFIG_PATH);
    return true;
  }

  static printConfig(config: SnapshotAnalyzerConfig): void {
    console.log(`Snapshot analyzer preset: ${config.preset}`);
    console.log(`Command prefix: ${formatCommandPrefix(config.commandPrefix)}`);
    console.log(`Config file: ${SNAPSHOT_ANALYZER_CONFIG_PATH}`);
    console.log(`Updated at: ${config.updatedAt}`);
  }

  static printConfigureUsage(): void {
    console.log(
      `Usage: libretto-cli snapshot configure <codex|opencode|claude> [-- <command prefix...>]
       libretto-cli snapshot configure --show
       libretto-cli snapshot configure --clear`,
    );
  }

  static configureFromArgs(args: string[]): void {
    if (args.includes("--show")) {
      const config = this.readConfiguredConfig();
      if (!config) {
        console.log(
          `No snapshot analyzer configured. Run 'libretto-cli snapshot configure codex' to set one.`,
        );
        return;
      }
      this.printConfig(config);
      return;
    }

    if (args.includes("--clear")) {
      const removed = this.clearConfig();
      if (removed) {
        console.log(
          `Cleared snapshot analyzer config: ${SNAPSHOT_ANALYZER_CONFIG_PATH}`,
        );
      } else {
        console.log("No snapshot analyzer config was set.");
      }
      return;
    }

    const presetArg = args[0];
    const parsedPreset = SnapshotAnalyzerPresetSchema.safeParse(presetArg);
    if (!parsedPreset.success) {
      this.printConfigureUsage();
      throw new Error(
        "Missing or invalid preset. Use one of: codex, opencode, claude.",
      );
    }

    const separator = args.indexOf("--");
    const customPrefix =
      separator >= 0 ? args.slice(separator + 1).filter(Boolean) : null;
    if (separator >= 0 && customPrefix && customPrefix.length === 0) {
      throw new Error("Custom command prefix cannot be empty after '--'.");
    }

    const preset = parsedPreset.data;
    const commandPrefix =
      customPrefix && customPrefix.length > 0
        ? customPrefix
        : SNAPSHOT_ANALYZER_PRESETS[preset];
    const config = this.writeConfig(preset, commandPrefix);
    console.log("Snapshot analyzer configured.");
    this.printConfig(config);
  }

  get snapshotAnalyzerConfig(): SnapshotAnalyzerConfig {
    return this.config;
  }

  protected get command(): string {
    const command = this.config.commandPrefix[0];
    if (!command) {
      throw new Error(
        "Snapshot analyzer config is invalid: command prefix is empty.",
      );
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

function runSnapshotConfigure(args: string[]): void {
  UserCodingAgent.configureFromArgs(args);
}

type ExternalCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

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
            `Command not found: ${command}. Configure a different analyzer with 'libretto-cli snapshot configure'.`,
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
    // eslint-disable-next-line no-control-regex
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

function hasProfile(domain: string): boolean {
  return existsSync(getProfilePath(domain));
}

async function tryConnectToPort(
  port: number,
  timeoutMs: number = 5000,
): Promise<Browser | null> {
  const endpoint = `http://localhost:${port}`;
  log.info("cdp-connect-attempt", { port, endpoint, timeoutMs });
  try {
    const connectPromise = chromium.connectOverCDP(endpoint);
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs),
    );
    const browser = await Promise.race([connectPromise, timeoutPromise]);
    if (browser) {
      log.info("cdp-connect-success", {
        port,
        endpoint,
        contexts: browser.contexts().length,
      });
    } else {
      log.warn("cdp-connect-timeout", { port, endpoint, timeoutMs });
    }
    return browser;
  } catch (err) {
    log.error("cdp-connect-error", { error: err, port, endpoint });
    return null;
  }
}

async function tryConnect(
  session: string,
  timeoutMs: number = 5000,
): Promise<Browser | null> {
  log.info("try-connect", { session, timeoutMs });
  const state = readSessionState(session);
  if (!state) {
    log.info("try-connect-no-state", { session });
    return null;
  }
  const browser = await tryConnectToPort(state.port, timeoutMs);
  if (!browser) {
    log.warn("try-connect-failed-clearing-state", {
      session,
      port: state.port,
      pid: state.pid,
    });
    clearSessionState(session);
    return null;
  }
  return browser;
}

/**
 * Drop the CDP connection without killing the remote browser.
 *
 * browser.close() can't be used here because it sends Browser.close over the
 * channel which can tear down the browser process — especially when multiple
 * CDP clients are connected simultaneously. Calling _connection.close()
 * directly drops just this client's WebSocket; the remote Chromium process and
 * any other CDP connections stay alive.
 */
function disconnectBrowser(browser: Browser, session?: string): void {
  log.info("cdp-disconnect", { session });
  try {
    (browser as any)._connection?.close();
  } catch (err) {
    log.warn("cdp-disconnect-already-closed", { error: err });
  }
}

// Connect to the browser via CDP and return the browser, context, and page.
// Commands MUST call disconnectBrowser() when done to drop the CDP connection
// without killing the remote Chromium process.
async function connect(
  session: string,
  timeoutMs: number = 10000,
): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  log.info("connect", { session, timeoutMs });
  const state = getSessionStateOrThrow(session);
  const browser = await tryConnectToPort(state.port, timeoutMs);
  if (!browser) {
    log.error("connect-no-browser", {
      session,
      port: state.port,
      pid: state.pid,
    });
    clearSessionState(session);
    throw new Error(
      `No browser running for session "${session}". Run 'libretto-cli open <url> --session ${session}' first.`,
    );
  }

  const contexts = browser.contexts();
  log.info("connect-contexts", { session, contextCount: contexts.length });
  if (contexts.length === 0) {
    log.error("connect-no-contexts", { session });
    throw new Error("No browser context found.");
  }

  const allPages = contexts.flatMap((c) => c.pages());
  const pages = allPages.filter((p) => {
    const url = p.url();
    return !url.startsWith("devtools://") && !url.startsWith("chrome-error://");
  });

  log.info("connect-pages", {
    session,
    totalPages: allPages.length,
    filteredPages: pages.length,
    urls: allPages.map((p) => p.url()),
  });

  if (pages.length === 0) {
    log.error("connect-no-pages", {
      session,
      allPageUrls: allPages.map((p) => p.url()),
    });
    throw new Error("No pages found.");
  }

  const page = pages[pages.length - 1]!;
  const context = page.context();

  // Attach diagnostic listeners so we can see exactly when/why page dies during a command
  page.on("close", () => {
    log.error("page-closed-during-command", {
      session,
      url: page.url(),
      trace: new Error("page-closed-trace").stack,
    });
  });
  page.on("crash", () => {
    log.error("page-crashed-during-command", {
      session,
      url: page.url(),
    });
  });
  browser.on("disconnected", () => {
    log.error("browser-disconnected-during-command", {
      session,
      trace: new Error("browser-disconnected-trace").stack,
    });
  });

  log.info("connect-success", { session, pageUrl: page.url() });
  return { browser, context, page };
}

async function runOpen(
  rawUrl: string,
  headed: boolean,
  session: string,
): Promise<void> {
  const url = normalizeUrl(rawUrl);
  log.info("open-start", { url, headed, session });

  const existing = await tryConnect(session);
  if (existing) {
    log.info("open-reuse-existing", { session });
    try {
      const page = existing.contexts()[0]?.pages()[0];
      if (page) {
        await page.goto(url);
        log.info("open-navigated", { url, session });
        console.log(`Navigated to: ${url}`);
        return;
      }
    } finally {
      disconnectBrowser(existing, session);
    }
  }

  const port = await pickFreePort();
  const runId = generateRunId();
  const runLogPath = logFileForRun(runId);

  // Re-initialize the CLI logger to point at the new run directory so all
  // open-* logs land alongside the child process logs.
  log = new Logger(
    ["libretto-cli"],
    [createFileLogSink({ filePath: runLogPath })],
  );

  const mode = headed ? "headed" : "headless";
  const domain = normalizeDomain(url);
  const profilePath = getProfilePath(domain);
  const useProfile = hasProfile(domain);

  log.info("open-launching", {
    url,
    mode,
    session,
    port,
    runId,
    domain,
    useProfile,
    profilePath: useProfile ? profilePath : undefined,
  });

  if (useProfile) {
    console.log(`Loading saved profile for ${domain}`);
  }
  console.log(
    `Launching ${mode} browser (session: ${session}, run: ${runId})...`,
  );

  const escapedProfilePath = profilePath
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
  const escapedUrl = url.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const storageStateCode = useProfile
    ? `storageState: '${escapedProfilePath}',`
    : "";

  const escapedLogPath = runLogPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  const launcherCode = `
import { chromium } from 'playwright';
import { appendFileSync, mkdirSync } from 'node:fs';

const LOG_FILE = '${escapedLogPath}';
const NETWORK_LOG = '${escapedLogPath}'.replace('session.log', 'network.jsonl');
const ACTIONS_LOG = NETWORK_LOG.replace('network.jsonl', 'actions.jsonl');
mkdirSync(NETWORK_LOG.replace(/\\/[^\\/]+$/, ''), { recursive: true });

const STATIC_EXT_RE = /\\.(css|js|png|jpg|jpeg|gif|woff|woff2|ttf|ico|svg)(\\?|$)/i;
async function logNetworkResponse(response) {
	try {
		const req = response.request();
		const url = req.url();
		if (STATIC_EXT_RE.test(url) || url.startsWith('chrome-extension://')) return;
		let responseBody = null;
		try {
			const buf = await response.body();
			responseBody = buf.toString('utf-8');
		} catch {}
		const entry = JSON.stringify({
			ts: new Date().toISOString(),
			method: req.method(),
			url,
			status: response.status(),
			contentType: response.headers()['content-type'] || null,
			postData: req.method() === 'POST' || req.method() === 'PUT' || req.method() === 'PATCH'
				? (req.postData() || '').substring(0, 2000)
				: undefined,
			responseBody,
		});
		appendFileSync(NETWORK_LOG, entry + '\\n');
	} catch {}
}

function logAction(entry) {
	try {
		const record = { ts: new Date().toISOString(), ...entry };
		appendFileSync(ACTIONS_LOG, JSON.stringify(record) + '\\n');
	} catch {}
}

function childLog(level, event, data = {}) {
	try {
		const entry = JSON.stringify({
			timestamp: new Date().toISOString(),
			id: Math.random().toString(36).slice(2, 10),
			level,
			scope: 'libretto-cli.child',
			event,
			data,
		});
		appendFileSync(LOG_FILE, entry + '\\n');
	} catch {}
}

async function setupActionTracking(p) {
	await p.exposeFunction('__btActionLog', (jsonStr) => {
		try { logAction({ ...JSON.parse(jsonStr), source: 'user' }); } catch {}
	});

	await p.addInitScript(() => {
		if (window.__btDomListenersInstalled) return;
		window.__btDomListenersInstalled = true;

		function identify(el) {
			if (!el || !el.tagName) return '';
			var tid = el.getAttribute('data-testid');
			if (tid) return '[data-testid="' + tid + '"]';
			var role = el.getAttribute('role') || '';
			var id = el.id;
			if (role && id) return role + '#' + id;
			var name = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30) || '';
			if (role && name) return role + ' "' + name + '"';
			var tag = el.tagName.toLowerCase();
			var cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
			return tag + cls;
		}

		var clickTimer = null;
		var pendingClick = null;

		document.addEventListener('click', function(e) {
			if (window.__btApiActionInProgress) return;
			var target = e.target;
			var sel = identify(target);
			if (target.type === 'checkbox') {
				if (typeof window.__btActionLog === 'function') {
					window.__btActionLog(JSON.stringify({ action: target.checked ? 'check' : 'uncheck', selector: sel, success: true }));
				}
				return;
			}
			pendingClick = { selector: sel };
			if (clickTimer) clearTimeout(clickTimer);
			clickTimer = setTimeout(function() {
				if (pendingClick && typeof window.__btActionLog === 'function') {
					window.__btActionLog(JSON.stringify({ action: 'click', selector: pendingClick.selector, success: true }));
				}
				pendingClick = null;
				clickTimer = null;
			}, 200);
		}, true);

		document.addEventListener('dblclick', function(e) {
			if (window.__btApiActionInProgress) return;
			if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; pendingClick = null; }
			var sel = identify(e.target);
			if (typeof window.__btActionLog === 'function') {
				window.__btActionLog(JSON.stringify({ action: 'dblclick', selector: sel, success: true }));
			}
		}, true);

		var inputTimers = new WeakMap();
		document.addEventListener('input', function(e) {
			if (window.__btApiActionInProgress) return;
			var target = e.target;
			var sel = identify(target);
			if (target.tagName === 'SELECT') {
				if (typeof window.__btActionLog === 'function') {
					window.__btActionLog(JSON.stringify({ action: 'selectOption', selector: sel, value: target.value, success: true }));
				}
				return;
			}
			var existing = inputTimers.get(target);
			if (existing) clearTimeout(existing);
			inputTimers.set(target, setTimeout(function() {
				inputTimers.delete(target);
				if (typeof window.__btActionLog === 'function') {
					window.__btActionLog(JSON.stringify({ action: 'fill', selector: sel, value: (target.value || '').slice(0, 100), success: true }));
				}
			}, 500));
		}, true);

		var SPECIAL_KEYS = ['Enter','Escape','Tab','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'];
		document.addEventListener('keydown', function(e) {
			if (window.__btApiActionInProgress) return;
			var isShortcut = e.ctrlKey || e.metaKey || e.altKey;
			if (!isShortcut && SPECIAL_KEYS.indexOf(e.key) === -1) return;
			var sel = identify(e.target);
			var keyDesc = (e.ctrlKey ? 'Ctrl+' : '') + (e.metaKey ? 'Meta+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + e.key;
			if (typeof window.__btActionLog === 'function') {
				window.__btActionLog(JSON.stringify({ action: 'press', selector: sel, value: keyDesc, success: true }));
			}
		}, true);

		var scrollTimer = null;
		document.addEventListener('scroll', function() {
			if (window.__btApiActionInProgress) return;
			if (scrollTimer) clearTimeout(scrollTimer);
			scrollTimer = setTimeout(function() {
				scrollTimer = null;
				if (typeof window.__btActionLog === 'function') {
					window.__btActionLog(JSON.stringify({ action: 'scroll', selector: 'document', value: 'y=' + window.scrollY, success: true }));
				}
			}, 300);
		}, true);
	});

	var PAGE_ACTIONS = ['click', 'dblclick', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'hover', 'focus'];
	var NAV_ACTIONS = ['goto', 'reload', 'goBack', 'goForward'];

	for (var m of PAGE_ACTIONS) {
		(function(method) {
			var orig = p[method].bind(p);
			p[method] = async function() {
				var args = Array.from(arguments);
				var start = Date.now();
				try { await p.evaluate(function() { window.__btApiActionInProgress = true; }); } catch {}
				try {
					var result = await orig.apply(null, args);
					logAction({ action: method, source: 'agent', selector: typeof args[0] === 'string' ? args[0] : undefined, value: args[1] !== undefined ? String(args[1]).slice(0, 100) : undefined, duration: Date.now() - start, success: true });
					return result;
				} catch (err) {
					logAction({ action: method, source: 'agent', selector: typeof args[0] === 'string' ? args[0] : undefined, duration: Date.now() - start, success: false, error: err.message });
					throw err;
				} finally {
					try { await p.evaluate(function() { window.__btApiActionInProgress = false; }); } catch {}
				}
			};
		})(m);
	}

	for (var m of NAV_ACTIONS) {
		(function(method) {
			var orig = p[method].bind(p);
			p[method] = async function() {
				var args = Array.from(arguments);
				var start = Date.now();
				try {
					var result = await orig.apply(null, args);
					logAction({ action: method, source: 'agent', url: typeof args[0] === 'string' ? args[0] : p.url(), duration: Date.now() - start, success: true });
					return result;
				} catch (err) {
					logAction({ action: method, source: 'agent', url: typeof args[0] === 'string' ? args[0] : undefined, duration: Date.now() - start, success: false, error: err.message });
					throw err;
				}
			};
		})(m);
	}

	var LOCATOR_FACTORIES = ['locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId'];
	for (var f of LOCATOR_FACTORIES) {
		(function(factory) {
			var orig = p[factory].bind(p);
			p[factory] = function() {
				var args = Array.from(arguments);
				var locator = orig.apply(null, args);
				var hint = factory + '(' + args.map(function(a) { return typeof a === 'string' ? a : JSON.stringify(a); }).join(', ') + ')';
				for (var am of PAGE_ACTIONS) {
					(function(actMethod) {
						if (typeof locator[actMethod] !== 'function') return;
						var origAct = locator[actMethod].bind(locator);
						locator[actMethod] = async function() {
							var actArgs = Array.from(arguments);
							var start = Date.now();
							try { await p.evaluate(function() { window.__btApiActionInProgress = true; }); } catch {}
							try {
								var result = await origAct.apply(null, actArgs);
								logAction({ action: actMethod, source: 'agent', selector: hint, value: actArgs[0] !== undefined ? String(actArgs[0]).slice(0, 100) : undefined, duration: Date.now() - start, success: true });
								return result;
							} catch (err) {
								logAction({ action: actMethod, source: 'agent', selector: hint, duration: Date.now() - start, success: false, error: err.message });
								throw err;
							} finally {
								try { await p.evaluate(function() { window.__btApiActionInProgress = false; }); } catch {}
							}
						};
					})(am);
				}
				return locator;
			};
		})(f);
	}
}

const browser = await chromium.launch({
	headless: ${!headed},
	args: ['--disable-blink-features=AutomationControlled', '--remote-debugging-port=${port}', '--remote-debugging-address=127.0.0.1', '--no-focus-on-check'],
});

browser.on('disconnected', () => {
	childLog('warn', 'browser-disconnected', { port: ${port} });
});

const context = await browser.newContext({
	${storageStateCode}
	viewport: { width: 1366, height: 768 },
	userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
});

const page = await context.newPage();
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(45000);

await setupActionTracking(page);

page.on('crash', () => childLog('error', 'page-crash', { url: page.url() }));
page.on('close', () => childLog('warn', 'page-close', { url: page.url(), trace: new Error('page-close-trace').stack }));
page.on('pageerror', (err) => childLog('error', 'page-error', { message: err.message, stack: err.stack }));
page.on('console', (msg) => {
	if (msg.type() === 'error' || msg.type() === 'warning') {
		childLog(msg.type() === 'error' ? 'error' : 'warn', 'console-' + msg.type(), { text: msg.text(), url: page.url() });
	}
});
page.on('framenavigated', (frame) => {
	if (frame === page.mainFrame()) {
		childLog('info', 'page-navigated', { url: frame.url() });
		logAction({ action: 'navigate', source: 'agent', url: frame.url(), success: true });
	}
});
page.on('requestfailed', (req) => {
	const failure = req.failure();
	childLog('warn', 'request-failed', { url: req.url(), method: req.method(), errorText: failure?.errorText });
});
page.on('response', logNetworkResponse);
page.on('popup', (popup) => logAction({ action: 'popup', source: 'agent', url: popup.url(), success: true }));
page.on('dialog', (dialog) => logAction({ action: 'dialog', source: 'agent', value: dialog.type() + ': ' + dialog.message().slice(0, 500), success: true }));

context.on('page', async (newPage) => {
	childLog('info', 'new-page-created', { url: newPage.url() });
	newPage.on('crash', () => childLog('error', 'page-crash', { url: newPage.url() }));
	newPage.on('close', () => childLog('info', 'page-close', { url: newPage.url(), trace: new Error('page-close-trace').stack }));
	newPage.on('response', logNetworkResponse);
	newPage.on('popup', (popup) => logAction({ action: 'popup', source: 'agent', url: popup.url(), success: true }));
	newPage.on('dialog', (dialog) => logAction({ action: 'dialog', source: 'agent', value: dialog.type() + ': ' + dialog.message().slice(0, 500), success: true }));
	newPage.on('framenavigated', (frame) => {
		if (frame === newPage.mainFrame()) logAction({ action: 'navigate', source: 'agent', url: frame.url(), success: true });
	});
	try { await setupActionTracking(newPage); } catch (err) {
		childLog('warn', 'action-tracking-setup-failed', { url: newPage.url(), error: err.message });
	}
});


await page.goto('${escapedUrl}');

process.on('SIGTERM', async () => {
	childLog('info', 'child-sigterm');
	await browser.close();
	process.exit(0);
});

process.on('SIGINT', async () => {
	childLog('info', 'child-sigint');
	await browser.close();
	process.exit(0);
});

process.on('uncaughtException', (err) => {
	childLog('error', 'uncaught-exception', { message: err.message, stack: err.stack });
	process.exit(1);
});

process.on('unhandledRejection', (reason) => {
	childLog('warn', 'unhandled-rejection', { reason: String(reason) });
});

process.on('exit', (code) => {
	childLog('info', 'child-exit', { code, pid: process.pid, port: ${port} });
});

childLog('info', 'child-launched', { port: ${port}, pid: process.pid, session: '${session}' });

await new Promise(() => {});
`;

  // Child stderr goes to the run log file alongside structured JSONL entries
  const childStderrFd = openSync(runLogPath, "a");

  const child = spawn("node", ["--input-type=module", "-e", launcherCode], {
    detached: true,
    stdio: ["ignore", "ignore", childStderrFd],
    cwd: join(REPO_ROOT, "packages", "libretto"),
  });
  child.unref();

  log.info("open-child-spawned", { pid: child.pid, port, session });

  child.on("error", (err) => {
    log.error("open-child-spawn-error", { error: err, session, port });
  });

  child.on("exit", (code, signal) => {
    log.warn("open-child-exited", {
      code,
      signal,
      session,
      port,
      pid: child.pid,
    });
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const ready = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then(() => true)
      .catch(() => false);
    if (i > 0 && i % 5 === 0) {
      log.info("open-waiting-for-cdp", { attempt: i, port, session });
    }
    if (ready) {
      writeSessionState({
        port,
        pid: child.pid!,
        session,
        runId,
        startedAt: new Date().toISOString(),
      });
      log.info("open-success", {
        url,
        mode,
        session,
        port,
        runId,
        pid: child.pid,
      });
      console.log(`Browser open (${mode}): ${url}`);

      // Wait a bit longer for the page to load
      await new Promise((r) => setTimeout(r, 2000));
      return;
    }
  }

  log.error("open-timeout", { session, port, pid: child.pid, attempts: 30 });
  throw new Error("Failed to connect to browser.");
}

async function runExec(
  code: string,
  session: string,
  visualize = false,
): Promise<void> {
  log.info("exec-start", {
    session,
    codeLength: code.length,
    codePreview: code.slice(0, 200),
    visualize,
  });
  const { browser, context, page } = await connect(session);
  const sessionState = getSessionStateOrThrow(session);

  // ── Stall detection ────────────────────────────────────────────────
  // Detects when an exec hangs silently (e.g. every Playwright locator times
  // out at 30s because the user navigated away in a headed browser). A 20s
  // interval checks whether any wrapped action has fired recently. If not, it
  // logs a warning to session.log so we can diagnose why an exec is taking
  // forever. The `onActivity` callback is passed into wrapPageForActionLogging
  // and wrapLocator so that every action (success or failure) resets the timer.
  const STALL_THRESHOLD_MS = 60_000;
  let lastActivityTs = Date.now();
  const onActivity = () => {
    lastActivityTs = Date.now();
  };

  const stallInterval = setInterval(() => {
    const silenceMs = Date.now() - lastActivityTs;
    if (silenceMs >= STALL_THRESHOLD_MS) {
      log.warn("exec-stall-warning", {
        session,
        silenceMs,
        codePreview: code.slice(0, 200),
      });
      console.warn(
        `[stall-warning] No Playwright activity for ${Math.round(silenceMs / 1000)}s — exec may be hung (code: ${code.slice(0, 100)}...)`,
      );
    }
  }, STALL_THRESHOLD_MS);

  // ── SIGINT handler ─────────────────────────────────────────────────
  // If the user Ctrl+C's a running exec, log the interruption with duration
  // and a code preview so we know what was running and for how long. The
  // handler is removed in the finally block to avoid leaking listeners.
  const execStartTs = Date.now();
  const sigintHandler = () => {
    log.info("exec-interrupted", {
      session,
      duration: Date.now() - execStartTs,
      codePreview: code.slice(0, 200),
    });
  };
  process.on("SIGINT", sigintHandler);

  wrapPageForActionLogging(page, sessionState.runId, onActivity);

  if (visualize) {
    await installInstrumentation(page, { visualize: true, logger: log });
  }

  try {
    const execState: Record<string, unknown> = {};

    const networkLog = (
      opts: { last?: number; filter?: string; method?: string } = {},
    ) => {
      return readNetworkLog(session, opts);
    };

    const actionLog = (
      opts: {
        last?: number;
        filter?: string;
        action?: string;
        source?: string;
      } = {},
    ) => {
      return readActionLog(session, opts);
    };

    const helpers = {
      page,
      context,
      state: execState,
      browser,
      networkLog,
      actionLog,
      console,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      fetch,
      URL,
      Buffer,
    };

    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const fn = new AsyncFunction(...Object.keys(helpers), code);

    const result = await fn(...Object.values(helpers));
    log.info("exec-success", { session, hasResult: result !== undefined });
    if (result !== undefined) {
      console.log(
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
      );
    }
  } catch (err) {
    log.error("exec-error", {
      error: err,
      session,
      codePreview: code.slice(0, 200),
    });
    throw err;
  } finally {
    clearInterval(stallInterval);
    process.removeListener("SIGINT", sigintHandler);
    disconnectBrowser(browser, session);
  }
}

async function captureScreenshot(session: string): Promise<ScreenshotPair> {
  log.info("screenshot-start", { session });
  const state = getSessionStateOrThrow(session);
  const runDir = getRunDir(state.runId);
  mkdirSync(runDir, { recursive: true });
  const { browser, page } = await connect(session);

  try {
    const title = await page.title();
    const pageUrl = page.url();
    const sanitizedTitle = title
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 50);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = `${sanitizedTitle}-${timestamp}`;

    const pngPath = join(runDir, `${baseName}.png`);
    const htmlPath = join(runDir, `${baseName}.html`);

    await page.screenshot({ path: pngPath });

    const htmlContent = await page.content();
    const fs = await import("node:fs/promises");
    await fs.writeFile(htmlPath, htmlContent);

    log.info("screenshot-success", {
      session,
      pageUrl,
      title,
      pngPath,
      htmlPath,
    });
    return { pngPath, htmlPath, baseName };
  } catch (err) {
    // Check if the browser/page is still alive to give better diagnostics
    let pageAlive = false;
    let browserConnected = false;
    try {
      browserConnected = browser.isConnected();
      pageAlive = !page.isClosed();
    } catch {}
    log.error("screenshot-error", {
      error: err,
      session,
      pageAlive,
      browserConnected,
      pageUrl: page.url(),
    });
    throw err;
  } finally {
    disconnectBrowser(browser, session);
  }
}

async function runSnapshot(
  session: string,
  objective: string,
  context: string,
): Promise<void> {
  const { pngPath, htmlPath } = await captureScreenshot(session);

  console.log(`Screenshot saved:`);
  console.log(`  PNG:  ${pngPath}`);
  console.log(`  HTML: ${htmlPath}`);

  await runInterpret({ objective, session, context, pngPath, htmlPath });
}

async function runInterpret(args: InterpretArgs): Promise<void> {
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
  } else if (llmClientFactory) {
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
  } else {
    throw new Error(
      "No snapshot analyzer configured. Run 'libretto-cli snapshot configure codex' (or opencode/claude). Library integrations can still set a factory via setLLMClientFactory().",
    );
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

async function runSave(urlOrDomain: string, session: string): Promise<void> {
  log.info("save-start", { urlOrDomain, session });
  const { browser, context, page } = await connect(session);

  try {
    // Wait a moment for any pending storage operations to complete
    await new Promise((r) => setTimeout(r, 500));

    const domain = normalizeDomain(urlOrDomain);
    const profilePath = getProfilePath(domain);

    // Use CDP to get cookies since context.cookies() doesn't work over CDP
    const cdpSession = await context.newCDPSession(page);
    const { cookies: rawCookies } = await cdpSession.send(
      "Network.getAllCookies",
    );

    // Convert CDP cookies to Playwright storageState format
    // Remove partitionKey if it's an object (Playwright expects string or undefined)
    const cookies = rawCookies.map((c: any) => {
      const cookie = { ...c };
      if (cookie.partitionKey && typeof cookie.partitionKey === "object") {
        delete cookie.partitionKey;
      }
      return cookie;
    });

    await cdpSession.detach();

    // Get localStorage/sessionStorage from all pages
    const origins: Array<{
      origin: string;
      localStorage: Array<{ name: string; value: string }>;
    }> = [];

    for (const ctx of browser.contexts()) {
      for (const pg of ctx.pages()) {
        try {
          const origin = new URL(pg.url()).origin;
          const localStorage = await pg.evaluate(() => {
            const items: Array<{ name: string; value: string }> = [];
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i);
              if (key) {
                items.push({
                  name: key,
                  value: window.localStorage.getItem(key) || "",
                });
              }
            }
            return items;
          });
          if (localStorage.length > 0) {
            origins.push({ origin, localStorage });
          }
        } catch {
          // Skip pages that can't be accessed
        }
      }
    }

    const state = { cookies, origins };
    const fs = await import("node:fs/promises");
    await fs.writeFile(profilePath, JSON.stringify(state, null, 2));

    log.info("save-success", {
      domain,
      profilePath,
      cookieCount: cookies.length,
      originCount: origins.length,
    });
    console.log(`Profile saved for ${domain}`);
    console.log(`   Location: ${profilePath}`);
    console.log(`   Cookies: ${cookies.length}, Origins: ${origins.length}`);
  } catch (err) {
    log.error("save-error", { error: err, urlOrDomain, session });
    throw err;
  } finally {
    disconnectBrowser(browser, session);
  }
}

export async function runClose(session: string): Promise<void> {
  ensureLog();
  log.info("close-start", { session });
  const state = readSessionState(session);
  if (!state) {
    log.info("close-no-session", { session });
    console.log(`No browser running for session "${session}".`);
    return;
  }

  log.info("close-killing", { session, pid: state.pid, port: state.port });

  // Send SIGTERM to the launcher process, which triggers its graceful
  // shutdown handler (browser.close() + process.exit).
  try {
    process.kill(state.pid, "SIGTERM");
  } catch (err) {
    log.warn("close-kill-failed", { error: err, session, pid: state.pid });
  }

  // Give the launcher process time to shut down gracefully
  await new Promise((r) => setTimeout(r, 1500));

  clearSessionState(session);
  log.info("close-success", { session });
  console.log(`Browser closed (session: ${session}).`);
}

type NetworkLogEntry = {
  ts: string;
  method: string;
  url: string;
  status: number;
  contentType: string | null;
  postData?: string;
  responseBody?: string | null;
  size: number | null;
  durationMs: number | null;
};

function getNetworkLogPath(runId: string): string {
  return join(getRunDir(runId), "network.jsonl");
}

function readNetworkLog(
  session: string,
  opts: { last?: number; filter?: string; method?: string } = {},
): NetworkLogEntry[] {
  const state = getSessionStateOrThrow(session);
  const logPath = getNetworkLogPath(state.runId);
  if (!existsSync(logPath)) return [];

  const lines = readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean);
  let entries: NetworkLogEntry[] = lines.map(
    (line) => JSON.parse(line) as NetworkLogEntry,
  );

  if (opts.method) {
    const m = opts.method.toUpperCase();
    entries = entries.filter((e) => e.method === m);
  }
  if (opts.filter) {
    const re = new RegExp(opts.filter, "i");
    entries = entries.filter((e) => re.test(e.url));
  }

  const last = opts.last ?? 20;
  if (entries.length > last) {
    entries = entries.slice(-last);
  }

  return entries;
}

function formatNetworkEntry(e: NetworkLogEntry): string {
  const time = e.ts.replace(/.*T/, "").replace(/\.\d+Z$/, "");
  const duration = e.durationMs != null ? `${e.durationMs}ms` : "?ms";
  const size = e.size != null ? `${e.size}B` : "";
  const parts = [
    `[${time}]`,
    `${e.status}`,
    `${e.method.padEnd(6)}`,
    e.url,
    duration,
    size,
  ].filter(Boolean);
  let line = parts.join(" ");
  if (e.postData) {
    line += `\n         body: ${e.postData.substring(0, 120)}${e.postData.length > 120 ? "..." : ""}`;
  }
  return line;
}

async function runNetwork(args: string[], session: string): Promise<void> {
  if (args.includes("--clear")) {
    const state = getSessionStateOrThrow(session);
    const logPath = getNetworkLogPath(state.runId);
    writeFileSync(logPath, "");
    console.log("Network log cleared.");
    return;
  }

  const { value: lastOpt } = extractOption(
    args,
    "--last",
    "Usage: libretto-cli network [--last N] [--filter regex] [--method METHOD] [--clear]",
  );
  const { value: filterOpt } = extractOption(
    args,
    "--filter",
    "Usage: libretto-cli network [--last N] [--filter regex] [--method METHOD] [--clear]",
  );
  const { value: methodOpt } = extractOption(
    args,
    "--method",
    "Usage: libretto-cli network [--last N] [--filter regex] [--method METHOD] [--clear]",
  );

  const entries = readNetworkLog(session, {
    last: lastOpt ? parseInt(lastOpt, 10) : undefined,
    filter: filterOpt,
    method: methodOpt,
  });

  if (entries.length === 0) {
    console.log("No network requests captured.");
    return;
  }

  for (const entry of entries) {
    console.log(formatNetworkEntry(entry));
  }
  console.log(`\n${entries.length} request(s) shown.`);
}

type ActionLogEntry = {
  ts: string;
  action: string;
  source: "user" | "agent";
  selector?: string;
  value?: string;
  url?: string;
  duration?: number;
  success: boolean;
  error?: string;
};

function getActionLogPath(runId: string): string {
  return join(getRunDir(runId), "actions.jsonl");
}

function parentLogAction(runId: string, entry: Record<string, unknown>): void {
  try {
    const record = { ts: new Date().toISOString(), ...entry };
    appendFileSync(getActionLogPath(runId), JSON.stringify(record) + "\n");
  } catch {}
}

function readActionLog(
  session: string,
  opts: {
    last?: number;
    filter?: string;
    action?: string;
    source?: string;
  } = {},
): ActionLogEntry[] {
  const state = getSessionStateOrThrow(session);
  const logPath = getActionLogPath(state.runId);
  if (!existsSync(logPath)) return [];

  const lines = readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean);
  let entries: ActionLogEntry[] = lines.map(
    (line) => JSON.parse(line) as ActionLogEntry,
  );

  if (opts.action) {
    const a = opts.action.toLowerCase();
    entries = entries.filter((e) => e.action === a);
  }
  if (opts.source) {
    const s = opts.source.toLowerCase();
    entries = entries.filter((e) => e.source === s);
  }
  if (opts.filter) {
    const re = new RegExp(opts.filter, "i");
    entries = entries.filter(
      (e) =>
        re.test(e.action) ||
        re.test(e.selector || "") ||
        re.test(e.value || "") ||
        re.test(e.url || ""),
    );
  }

  const last = opts.last ?? 20;
  if (entries.length > last) {
    entries = entries.slice(-last);
  }

  return entries;
}

function formatActionEntry(e: ActionLogEntry): string {
  const time = e.ts.replace(/.*T/, "").replace(/\.\d+Z$/, "");
  const src = e.source.toUpperCase().padEnd(5);
  const parts = [`[${time}]`, `[${src}]`, e.action];
  if (e.selector) parts.push(e.selector);
  if (e.value) parts.push(`"${e.value}"`);
  if (e.url) parts.push(e.url);
  if (e.duration != null) parts.push(`${e.duration}ms`);
  if (!e.success) parts.push(`ERROR: ${e.error || "unknown"}`);
  return parts.join(" ");
}

async function runActions(args: string[], session: string): Promise<void> {
  if (args.includes("--clear")) {
    const state = getSessionStateOrThrow(session);
    const logPath = getActionLogPath(state.runId);
    writeFileSync(logPath, "");
    console.log("Action log cleared.");
    return;
  }

  const usageMsg =
    "Usage: libretto-cli actions [--last N] [--filter regex] [--action TYPE] [--source SOURCE] [--clear]";
  const { value: lastOpt } = extractOption(args, "--last", usageMsg);
  const { value: filterOpt } = extractOption(args, "--filter", usageMsg);
  const { value: actionOpt } = extractOption(args, "--action", usageMsg);
  const { value: sourceOpt } = extractOption(args, "--source", usageMsg);

  const entries = readActionLog(session, {
    last: lastOpt ? parseInt(lastOpt, 10) : undefined,
    filter: filterOpt,
    action: actionOpt,
    source: sourceOpt,
  });

  if (entries.length === 0) {
    console.log("No actions captured.");
    return;
  }

  for (const entry of entries) {
    console.log(formatActionEntry(entry));
  }
  console.log(`\n${entries.length} action(s) shown.`);
}

// ── Action logging wrappers ─────────────────────────────────────────────
// Monkey-patches the Playwright Page so every user-facing action (click, fill,
// goto, etc.) and every locator factory (page.locator(), page.getByRole(), …)
// writes a structured entry to actions.jsonl. The `onActivity` callback is
// called on every action (success or failure) so callers (e.g. stall detection
// in runExec) can track when the last interaction happened.
function wrapPageForActionLogging(
  page: Page,
  runId: string,
  onActivity?: () => void,
): void {
  const PAGE_ACTIONS = [
    "click",
    "dblclick",
    "fill",
    "type",
    "press",
    "check",
    "uncheck",
    "selectOption",
    "hover",
    "focus",
  ] as const;
  const NAV_ACTIONS = ["goto", "reload", "goBack", "goForward"] as const;

  for (const method of PAGE_ACTIONS) {
    const orig = (page as any)[method].bind(page);
    (page as any)[method] = async (...args: any[]) => {
      const start = Date.now();
      try {
        await page.evaluate(() => {
          (window as any).__btApiActionInProgress = true;
        });
      } catch {}
      try {
        const result = await orig(...args);
        parentLogAction(runId, {
          action: method,
          source: "agent",
          selector: typeof args[0] === "string" ? args[0] : undefined,
          value:
            args[1] !== undefined ? String(args[1]).slice(0, 100) : undefined,
          duration: Date.now() - start,
          success: true,
        });
        onActivity?.();
        return result;
      } catch (err: any) {
        parentLogAction(runId, {
          action: method,
          source: "agent",
          selector: typeof args[0] === "string" ? args[0] : undefined,
          duration: Date.now() - start,
          success: false,
          error: err.message,
        });
        onActivity?.();
        throw err;
      } finally {
        try {
          await page.evaluate(() => {
            (window as any).__btApiActionInProgress = false;
          });
        } catch {}
      }
    };
  }

  for (const method of NAV_ACTIONS) {
    const orig = (page as any)[method].bind(page);
    (page as any)[method] = async (...args: any[]) => {
      const start = Date.now();
      try {
        const result = await orig(...args);
        parentLogAction(runId, {
          action: method,
          source: "agent",
          url: typeof args[0] === "string" ? args[0] : page.url(),
          duration: Date.now() - start,
          success: true,
        });
        onActivity?.();
        return result;
      } catch (err: any) {
        parentLogAction(runId, {
          action: method,
          source: "agent",
          url: typeof args[0] === "string" ? args[0] : undefined,
          duration: Date.now() - start,
          success: false,
          error: err.message,
        });
        onActivity?.();
        throw err;
      }
    };
  }

  const LOCATOR_FACTORIES = [
    "locator",
    "getByRole",
    "getByText",
    "getByLabel",
    "getByPlaceholder",
    "getByAltText",
    "getByTitle",
    "getByTestId",
  ] as const;

  for (const factory of LOCATOR_FACTORIES) {
    const orig = (page as any)[factory].bind(page);
    (page as any)[factory] = (...factoryArgs: any[]) => {
      const locator = orig(...factoryArgs);
      const hint = formatHint(factory, factoryArgs);
      return wrapLocator(locator, hint, runId, page, onActivity);
    };
  }
}

// Locator action methods that perform side effects or queries — these get
// wrapped with logging so every interaction is captured in actions.jsonl.
const LOCATOR_ACTION_METHODS = [
  "click",
  "dblclick",
  "fill",
  "type",
  "press",
  "check",
  "uncheck",
  "selectOption",
  "hover",
  "focus",
  "scrollIntoViewIfNeeded",
  "waitFor",
  "innerHTML",
  "innerText",
  "textContent",
  "inputValue",
  "isChecked",
  "isDisabled",
  "isEditable",
  "isEnabled",
  "isHidden",
  "isVisible",
  "count",
  "boundingBox",
  "screenshot",
  "evaluate",
  "evaluateAll",
  "evaluateHandle",
  "getAttribute",
  "dispatchEvent",
  "setInputFiles",
  "selectText",
  "dragTo",
  "highlight",
  "tap",
] as const;

// Locator methods that return a new Locator — these get wrapped so the
// returned child locator is also recursively wrapped via wrapLocator().
const LOCATOR_RETURNING_METHODS = [
  "first",
  "last",
  "locator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "getByTestId",
  "filter",
  "and",
  "or",
] as const;

// Builds a human-readable string like `locator("div")` or `getByRole("button", {"name":"Submit"})`.
// Used as the `selector` field in action log entries so you can trace the full
// locator chain, e.g. `locator("[role=\"listitem\"]").first().locator("button")`.
function formatHint(method: string, args: any[]): string {
  const formatted = args.map((a: any) => JSON.stringify(a)).join(", ");
  return `${method}(${formatted})`;
}

// Recursively wraps a Playwright Locator so that:
//  1. Action methods (click, fill, etc.) log to actions.jsonl with the full
//     chained selector hint and call onActivity() for stall detection.
//  2. Locator-returning methods (first(), last(), filter(), locator(), getBy*(),
//     etc.) return a new wrapped locator with the hint chain extended, e.g.
//     `locator("div").first().locator("button")`.
//  3. all() returns an array of individually wrapped locators.
//
// Without this, only the top-level page.locator() return was wrapped — chained
// calls like `.first()` or `.locator()` on a locator produced unwrapped results,
// so their actions were invisible in the log. This caused execs to hang for
// minutes with zero feedback because every timed-out locator action was silent.
//
// The __librettoActionLogged flag prevents double-wrapping if the same locator
// object passes through this function more than once.
function wrapLocator(
  locator: any,
  hint: string,
  runId: string,
  page: Page,
  onActivity?: () => void,
): any {
  if (locator.__librettoActionLogged) return locator;
  locator.__librettoActionLogged = true;

  // Wrap action methods with logging — each logs to actions.jsonl and resets
  // the stall detection timer via onActivity()
  for (const actMethod of LOCATOR_ACTION_METHODS) {
    if (typeof locator[actMethod] !== "function") continue;
    const origAct = locator[actMethod].bind(locator);
    locator[actMethod] = async (...actArgs: any[]) => {
      const start = Date.now();
      try {
        await page.evaluate(() => {
          (window as any).__btApiActionInProgress = true;
        });
      } catch {}
      try {
        const result = await origAct(...actArgs);
        parentLogAction(runId, {
          action: actMethod,
          source: "agent",
          selector: hint,
          value:
            actArgs[0] !== undefined
              ? String(actArgs[0]).slice(0, 100)
              : undefined,
          duration: Date.now() - start,
          success: true,
        });
        onActivity?.();
        return result;
      } catch (err: any) {
        parentLogAction(runId, {
          action: actMethod,
          source: "agent",
          selector: hint,
          duration: Date.now() - start,
          success: false,
          error: err.message,
        });
        onActivity?.();
        throw err;
      } finally {
        try {
          await page.evaluate(() => {
            (window as any).__btApiActionInProgress = false;
          });
        } catch {}
      }
    };
  }

  // Wrap locator-returning methods so the child locator is also wrapped,
  // extending the hint chain (e.g. `locator("div").first()` → `locator("div").first().locator("span")`)
  for (const method of LOCATOR_RETURNING_METHODS) {
    if (typeof locator[method] !== "function") continue;
    const origMethod = locator[method].bind(locator);
    locator[method] = (...args: any[]) => {
      const child = origMethod(...args);
      const childHint =
        args.length > 0
          ? `${hint}.${formatHint(method, args)}`
          : `${hint}.${method}()`;
      return wrapLocator(child, childHint, runId, page, onActivity);
    };
  }

  // nth() is handled separately from LOCATOR_RETURNING_METHODS because its
  // argument is a number (index), not a string/object like the other methods
  if (typeof locator.nth === "function") {
    const origNth = locator.nth.bind(locator);
    locator.nth = (index: number) => {
      const child = origNth(index);
      const childHint = `${hint}.nth(${index})`;
      return wrapLocator(child, childHint, runId, page, onActivity);
    };
  }

  // all() resolves to an array of Locator elements — wrap each one individually
  // with an indexed hint like `locator("li").all()[0]`, `locator("li").all()[1]`, etc.
  if (typeof locator.all === "function") {
    const origAll = locator.all.bind(locator);
    locator.all = async () => {
      const items: any[] = await origAll();
      return items.map((item: any, i: number) => {
        const childHint = `${hint}.all()[${i}]`;
        return wrapLocator(item, childHint, runId, page, onActivity);
      });
    };
  }

  return locator;
}

function printUsage(): void {
  console.log(`Usage: libretto-cli <command> [--session <name>]

Commands:
  open <url> [--headless] Launch browser and open URL (headed by default)
                          Automatically loads saved profile if available
  run <jobType> [--params <json> | --params-file <path>]  Run a registered local integration job
  save <url|domain>       Save current browser session (cookies, localStorage, etc.)
  exec <code> [--visualize]  Execute Playwright typescript code (--visualize enables ghost cursor + highlight)
  snapshot --objective <text> --context <text>  Capture PNG + HTML and analyze with configured analyzer (run snapshot configure first)
  snapshot configure <codex|opencode|claude> [-- <command prefix...>]  Configure snapshot analyzer
  network [--last N] [--filter regex] [--method M] [--clear]  View captured network requests
  actions [--last N] [--filter regex] [--action TYPE] [--source SOURCE] [--clear]  View captured actions
  interpret --objective <text> --context <text> [--png <path>] [--html <path>]   Interpret a snapshot PNG + HTML pair
  close                   Close the browser

Options:
  --session <name>        Use a named session (default: "default")
                          Built-in sessions: default, dev-server, browser-agent

Examples:
  libretto-cli open https://linkedin.com
  # ... manually log in ...
  libretto-cli save linkedin.com
  # Next time you open linkedin.com, you'll be logged in automatically

  libretto-cli exec "await page.locator('button:has-text(\\"Sign in\\")').click()"
  libretto-cli exec "await page.fill('input[name=\\"email\\"]', 'test@example.com')"
  libretto-cli snapshot configure codex
  libretto-cli snapshot configure opencode
  libretto-cli snapshot configure claude
  libretto-cli snapshot configure codex -- codex exec --skip-git-repo-check --sandbox read-only
  libretto-cli snapshot --objective "Find the submit button" --context "Submitting a referral form, already filled in patient details"
  libretto-cli close

  # Multiple sessions
  libretto-cli open https://site1.com --session test1
  libretto-cli open https://site2.com --session test2
  libretto-cli exec "return await page.title()" --session test1

Available in exec:
  page, context, state, browser, networkLog, actionLog

Profiles:
  Profiles are saved to .libretto-cli/profiles/<domain>.json (git-ignored)
  They persist cookies, localStorage, and session data across browser launches.

Sessions:
  Session state is stored in tmp/libretto-cli/<session>.json
  Each session runs an isolated browser instance on a dynamic port.
`);
}

const CLI_COMMANDS = new Set([
  "open",
  "run",
  "save",
  "exec",
  "snapshot",
  "interpret",
  "network",
  "actions",
  "close",
  "--help",
  "-h",
  "help",
]);

function parseSession(args: string[]): string {
  const idx = args.indexOf("--session");
  if (idx >= 0) {
    const value = args[idx + 1];
    if (!value || value.startsWith("--") || CLI_COMMANDS.has(value)) {
      throw new Error(
        "Usage: libretto-cli <command> [--session <name>]\nMissing or invalid --session value.",
      );
    }
    validateSessionName(value);
    return value;
  }
  return SESSION_DEFAULT;
}

function filterSessionArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session") {
      i++; // Skip the session value too
    } else {
      result.push(args[i]!);
    }
  }
  return result;
}

function extractOption(
  args: string[],
  option: string,
  usage?: string,
): { value?: string; args: string[] } {
  const result: string[] = [];
  let value: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === option) {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(
          usage ||
            `Usage: libretto-cli interpret <objective> [--png <path>] [--html <path>] [--session <name>]`,
        );
      }
      value = next;
      i++;
      continue;
    }
    result.push(arg);
  }

  return { value, args: result };
}

function parseRunParamsArgs(args: string[]): unknown {
  const { value: inlineParams, args: withoutInline } = extractOption(
    args,
    "--params",
    "Usage: libretto-cli run <jobType> [--params <json> | --params-file <path>] [--session <name>]",
  );
  const { value: paramsFile, args: remaining } = extractOption(
    withoutInline,
    "--params-file",
    "Usage: libretto-cli run <jobType> [--params <json> | --params-file <path>] [--session <name>]",
  );

  if (inlineParams && paramsFile) {
    throw new Error("Pass either --params or --params-file, not both.");
  }

  if (paramsFile) {
    const content = readFileSync(paramsFile, "utf8");
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Invalid JSON in --params-file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (inlineParams) {
    try {
      return JSON.parse(inlineParams);
    } catch (error) {
      throw new Error(
        `Invalid JSON in --params: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const unexpected = remaining.slice(2).find((arg) => arg.startsWith("--"));
  if (unexpected) {
    throw new Error(`Unknown option for run command: ${unexpected}`);
  }
  return {};
}

export async function runLibrettoCLI(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // Determine the run directory for logging.
  // For existing sessions, read the runId from state. For new sessions (open),
  // the runId is generated inside runOpen and the logger uses a fallback until then.
  const sessionForLog = (() => {
    try {
      return parseSession(rawArgs);
    } catch {
      return SESSION_DEFAULT;
    }
  })();

  const runIdForLog = (() => {
    try {
      // Read state file directly — readSessionState() uses `log` which isn't initialized yet.
      const stateFile = getStateFilePath(sessionForLog);
      if (existsSync(stateFile)) {
        const state = JSON.parse(
          readFileSync(stateFile, "utf-8"),
        ) as SessionState;
        if (state?.runId) return state.runId;
      }
    } catch {}
    return null;
  })();

  const logFilePath = (() => {
    if (runIdForLog) return logFileForRun(runIdForLog);
    mkdirSync(STATE_DIR, { recursive: true });
    return join(STATE_DIR, "cli.log");
  })();

  log = new Logger(
    ["libretto-cli"],
    [createFileLogSink({ filePath: logFilePath })],
  );

  log.info("cli-start", {
    args: rawArgs,
    cwd: cwd(),
    session: sessionForLog,
    runId: runIdForLog,
  });
  try {
    const session = parseSession(rawArgs);
    const args = filterSessionArgs(rawArgs);
    const command = args[0];

    log.info("cli-command", { command, session, args });

    switch (command) {
      case "open": {
        const hasHeadedFlag = args.includes("--headed");
        const hasHeadlessFlag = args.includes("--headless");
        if (hasHeadedFlag && hasHeadlessFlag) {
          console.error("Cannot pass both --headed and --headless.");
          process.exit(1);
        }
        const headed = hasHeadedFlag || !hasHeadlessFlag;
        const url = args.slice(1).find((a) => !a.startsWith("--"));
        if (!url) {
          console.error(
            "Usage: libretto-cli open <url> [--headless] [--session <name>]",
          );
          process.exit(1);
        }
        await runOpen(url, headed, session);
        break;
      }
      case "run": {
        const jobType = args[1];
        if (!jobType || jobType.startsWith("--")) {
          console.error(
            "Usage: libretto run <jobType> [--params <json>] [--session <name>] [--config <json>]",
          );
          process.exit(1);
        }

        const params = parseRunParamsArgs(args);
        const rawConfig = (() => {
          const idx = args.indexOf("--config");
          if (idx < 0) return undefined;
          return args[idx + 1];
        })();
        let config: LaunchConfig | undefined;
        if (rawConfig) {
          try {
            config = JSON.parse(rawConfig);
          } catch {
            console.error("Invalid JSON for --config");
            process.exit(1);
          }
        }
        const result = await launchJob({ jobType, params, session, config });
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case "status": {
        const status = await getJobStatus({ session });
        console.log(JSON.stringify(status, null, 2));
        break;
      }
      case "stop": {
        const stopResult = await stopJob({ session });
        console.log(
          stopResult.stopped
            ? `Session "${session}" stopped.`
            : `Session "${session}" is not running.`,
        );
        break;
      }
      case "wait-until-pause": {
        const timeoutStr = (() => {
          const idx = args.indexOf("--timeout");
          if (idx < 0) return undefined;
          return args[idx + 1];
        })();
        const timeoutMs = timeoutStr
          ? parseInt(timeoutStr, 10) * 1000
          : undefined;
        const pauseResult = await waitForPause({ session, timeoutMs });
        console.log(JSON.stringify(pauseResult, null, 2));
        break;
      }
      case "resume": {
        const resumeResult = await resumeJob({ session });
        console.log(
          resumeResult.signaled
            ? "Resume signal sent."
            : "Failed to send resume signal.",
        );
        break;
      }
      case "save": {
        const urlOrDomain = args[1];
        if (!urlOrDomain) {
          console.error(
            "Usage: libretto-cli save <url|domain> [--session <name>]",
          );
          process.exit(1);
        }
        await runSave(urlOrDomain, session);
        break;
      }
      case "exec": {
        const visualize = args.includes("--visualize");
        const code = args
          .slice(1)
          .filter((a) => a !== "--visualize" && !a.startsWith("--"))
          .join(" ");
        if (!code) {
          console.error(
            "Usage: libretto-cli exec <code> [--session <name>] [--visualize]",
          );
          process.exit(1);
        }
        await runExec(code, session, visualize);
        break;
      }
      case "snapshot": {
        if (args[1] === "configure") {
          runSnapshotConfigure(args.slice(2));
          break;
        }
        const configuredAgent = UserCodingAgent.getConfigured();
        const canAnalyzeSnapshots =
          configuredAgent !== null || llmClientFactory !== null;
        const { value: objective, args: withoutObjective } = extractOption(
          args,
          "--objective",
          "Usage: libretto-cli snapshot --objective <text> --context <text> [--session <name>]",
        );
        const { value: context } = extractOption(
          withoutObjective,
          "--context",
          "Usage: libretto-cli snapshot --objective <text> --context <text> [--session <name>]",
        );
        if (!objective || !context) {
          let message =
            "Error: both --objective and --context are required.\n" +
            "Usage: libretto-cli snapshot --objective <text> --context <text> [--session <name>]";
          if (args.includes("--objective") && !canAnalyzeSnapshots) {
            message +=
              "\nNo snapshot analyzer configured. Run 'libretto-cli snapshot configure codex' (or opencode/claude) first.";
          }
          console.error(message);
          process.exit(1);
        }
        if (!canAnalyzeSnapshots) {
          console.error(
            "No snapshot analyzer configured. Run 'libretto-cli snapshot configure codex' (or opencode/claude) first.",
          );
          process.exit(1);
        }
        await runSnapshot(session, objective, context);
        break;
      }
      case "interpret": {
        const { value: pngPath, args: withoutPng } = extractOption(
          args,
          "--png",
          "Usage: libretto-cli interpret --objective <text> --context <text> [--png <path>] [--html <path>] [--session <name>]",
        );
        const { value: htmlPath, args: withoutHtml } = extractOption(
          withoutPng,
          "--html",
          "Usage: libretto-cli interpret --objective <text> --context <text> [--png <path>] [--html <path>] [--session <name>]",
        );
        const { value: objective, args: withoutObjective } = extractOption(
          withoutHtml,
          "--objective",
          "Usage: libretto-cli interpret --objective <text> --context <text> [--png <path>] [--html <path>] [--session <name>]",
        );
        const { value: context, args: _withoutContext } = extractOption(
          withoutObjective,
          "--context",
          "Usage: libretto-cli interpret --objective <text> --context <text> [--png <path>] [--html <path>] [--session <name>]",
        );
        if (!objective || !context) {
          console.error(
            "Error: both --objective and --context are required.\n" +
              "Usage: libretto-cli interpret --objective <text> --context <text> [--png <path>] [--html <path>] [--session <name>]",
          );
          process.exit(1);
        }
        await runInterpret({ objective, session, context, pngPath, htmlPath });
        break;
      }
      case "network":
        await runNetwork(args, session);
        break;
      case "actions":
        await runActions(args, session);
        break;
      case "close":
        await runClose(session);
        break;
      case "--help":
      case "-h":
      case "help":
        printUsage();
        break;
      default:
        if (command) console.error(`Unknown command: ${command}\n`);
        printUsage();
        process.exit(command ? 1 : 0);
    }
  } catch (err) {
    log.error("cli-error", { error: err, args: rawArgs });
    await log.flush();
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
  await log.flush();
  process.exit(0);
}

// Auto-configure LLM client from env vars when running as standalone CLI
if (!llmClientFactory) {
  const hasAnyCreds =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY;

  if (hasAnyCreds) {
    setLLMClientFactory(async (_logger, model) => {
      const { createLLMClient } = await import("../src/llm/client.js");
      return createLLMClient(model);
    });
  }
}

runLibrettoCLI();
