import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  execFile,
  spawnSync,
} from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test as base } from "vitest";
import { SESSION_STATE_VERSION, type SessionState } from "../src/shared/state/index.js";

type SpawnResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type EvaluationResult = {
  success: boolean;
  reason: string;
  cached: boolean;
  model: string;
};

type EvaluateMatcher = {
  toMatch: (assertion: string) => Promise<EvaluationResult>;
};

type CliFixtures = {
  workspaceDir: string;
  workspacePath: (...parts: string[]) => string;
  librettoRuntimePath: string;
  librettoCli: (
    command: string,
    env?: Record<string, string>,
  ) => Promise<SpawnResult>;
  evaluate: (actual: string) => EvaluateMatcher;
  writeWorkflow: (
    fileName: string,
    source: string,
    imports?: string[],
  ) => Promise<string>;
  writeWorkflowScript: (fileName: string, source: string) => Promise<string>;
  seedSessionState: (state?: Partial<SessionState>) => Promise<SessionState>;
  seedSessionPermission: (
    session: string,
    mode: "read-only" | "full-access",
  ) => Promise<string>;
  seedProfile: (domain: string, sourcePath: string) => Promise<string>;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");
const packageRoot = repoRoot;
const cliEntry = resolve(packageRoot, "dist/cli/index.js");
const librettoEntry = resolve(packageRoot, "dist/index.js");
const librettoRuntimePath = new URL("../dist/index.js", import.meta.url)
  .href;
const DETERMINISTIC_WORKSPACE_ROOT = join(tmpdir(), "libretto-test-workspaces");
const EVALUATE_MODEL = "local-evaluate-v1";

let didBuild = false;

function ensureBuilt(): void {
  if (didBuild && existsSync(cliEntry) && existsSync(librettoEntry)) return;
  if (existsSync(cliEntry) && existsSync(librettoEntry)) {
    didBuild = true;
    return;
  }
  const buildResult = spawnSync("pnpm", ["build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (buildResult.status !== 0) {
    throw new Error(
      `Failed to build libretto before tests.\n${buildResult.stdout}\n${buildResult.stderr}`,
    );
  }
  didBuild = true;
}

function parseCommandArgs(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escape = false;

  for (const char of command) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) args.push(current);
  return args;
}

async function execProcess(
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<SpawnResult> {
  return await new Promise<SpawnResult>((resolveResult, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        env: { ...process.env, ...env },
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolveResult({
            exitCode: 0,
            stdout: String(stdout),
            stderr: String(stderr),
          });
          return;
        }

        const candidate = (
          error as NodeJS.ErrnoException & { code?: number | string }
        ).code;
        const exitCode = typeof candidate === "number" ? candidate : 1;
        if (error.name === "AbortError") {
          reject(error);
          return;
        }
        resolveResult({
          exitCode,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

function stripCodeFence(source: string): string {
  const trimmed = source.trim();
  const match = trimmed.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
  return match ? match[1] : source;
}

function workflowImportHeader(imports?: string[]): string {
  const names = imports && imports.length > 0 ? imports : ["workflow"];
  return `import { ${names.join(", ")} } from "${librettoRuntimePath}";\n\n`;
}

function stableEvaluateHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function workspaceDirForTask(task: Readonly<{ fullName: string; file: { filepath: string } }>): string {
  const stableId = stableEvaluateHash(`${task.file.filepath}::${task.fullName}`).slice(0, 16);
  return join(DETERMINISTIC_WORKSPACE_ROOT, stableId);
}

type EvaluateCheck = (actual: string, match: RegExpMatchArray) => string | null;

type EvaluateRule = {
  pattern: RegExp;
  check: EvaluateCheck;
};

function normalizeOutput(actual: string): string {
  return actual.replace(/\r\n/g, "\n");
}

function requireIncludes(actual: string, expected: string, label = expected): string | null {
  return actual.includes(expected) ? null : `Missing ${label}.\nActual output:\n${actual}`;
}

function requireRegex(actual: string, pattern: RegExp, label: string): string | null {
  return pattern.test(actual) ? null : `Missing ${label}.\nActual output:\n${actual}`;
}

function runChecks(
  actual: string,
  ...checks: Array<string | null>
): string | null {
  return checks.find((check): check is string => check !== null) ?? null;
}

const EVALUATE_RULES: readonly EvaluateRule[] = [
  {
    pattern: /^Shows the root CLI help with top-level command usage and includes the snapshot command description\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, "Usage: libretto <command>"),
        requireIncludes(actual, "snapshot"),
        requireIncludes(actual, "Capture PNG + HTML"),
      ),
  },
  {
    pattern: /^Shows the root CLI help with the top-level commands list\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, "Usage: libretto <command>"),
        requireIncludes(actual, "Commands:"),
        requireIncludes(actual, "open"),
        requireIncludes(actual, "ai"),
      ),
  },
  {
    pattern: /^Confirms the browser opened successfully for example\.com(?:.*)\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, "Browser open"),
        requireIncludes(actual, "example.com"),
      ),
  },
  {
    pattern: /^Lists the currently open page for example\.com\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, "Open pages:"),
        requireIncludes(actual, "example.com"),
      ),
  },
  {
    pattern: /^Reports that the browser for session "([^"]+)" was closed\.$/,
    check: (actual, match) =>
      runChecks(
        actual,
        requireIncludes(actual, "Browser closed"),
        requireIncludes(actual, match[1]!),
      ),
  },
  {
    pattern: /^Shows usage for exec command requiring code with optional session and visualize flags\.$/,
    check: (actual) =>
      requireIncludes(actual, "Usage: libretto exec <code> [--session <name>] [--visualize]"),
  },
  {
    pattern: /^Explains that the integration file does not exist and mentions the integration\.ts path\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, "Integration file does not exist:"),
        requireIncludes(actual, "integration.ts"),
      ),
  },
  {
    pattern: /^Reports that --params contained invalid JSON\.$/,
    check: (actual) => requireIncludes(actual, "Invalid JSON in --params:"),
  },
  {
    pattern: /^Reports that the provided session name is invalid and only allows letters, numbers, dots, underscores, and dashes\.$/,
    check: (actual) =>
      requireIncludes(actual, "Invalid session name. Use only letters, numbers, dots, underscores, and dashes."),
  },
  {
    pattern: /^Reports that --params-file contained invalid JSON\.$/,
    check: (actual) => requireIncludes(actual, "Invalid JSON in --params-file:"),
  },
  {
    pattern: /^Includes TSCONFIG_ALIAS_OK and Integration completed\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, "TSCONFIG_ALIAS_OK"),
        requireIncludes(actual, "Integration completed."),
      ),
  },
  {
    pattern: /^Reports that importing the integration module failed because of a TypeScript compilation error and includes guidance to pass --tsconfig <path>\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, "--tsconfig <path>"),
        requireRegex(actual, /(failed|error|transform)/i, "a compilation failure"),
      ),
  },
  {
    pattern: /^Reports that --session is missing its required value\.$/,
    check: (actual) => requireIncludes(actual, "Missing or invalid --session value."),
  },
  {
    pattern: /^Reports that the session flag is missing or invalid\.$/,
    check: (actual) => requireIncludes(actual, "Missing or invalid --session value."),
  },
  {
    pattern: /^Explains that no AI config is currently set\.$/,
    check: (actual) => requireIncludes(actual, "No AI config set."),
  },
  {
    pattern: /^Confirms the AI config was saved\.$/,
    check: (actual) => requireIncludes(actual, "AI config saved."),
  },
  {
    pattern: /^Shows that the configured AI preset is codex\.$/,
    check: (actual) => requireIncludes(actual, "AI preset: codex"),
  },
  {
    pattern: /^Confirms the AI config was cleared\.$/,
    check: (actual) => requireIncludes(actual, "Cleared AI config:"),
  },
  {
    pattern: /^Shows that the configured AI preset is gemini\.$/,
    check: (actual) => requireIncludes(actual, "AI preset: gemini"),
  },
  {
    pattern: /^Shows that the AI preset is codex and includes the custom command prefix "(.+)"\.$/,
    check: (actual, match) =>
      runChecks(
        actual,
        requireIncludes(actual, "AI preset: codex"),
        requireIncludes(actual, `Command prefix: ${match[1]!}`),
      ),
  },
  {
    pattern: /^Includes an interpretation and the answer (snapshot-ok-[^.]+)\.$/,
    check: (actual, match) =>
      runChecks(
        actual,
        requireIncludes(actual, "Interpretation:"),
        requireIncludes(actual, `Answer: ${match[1]!}`),
      ),
  },
  {
    pattern: /^Shows at least one network request result for the session\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, "example.com/?network=one"),
        requireIncludes(actual, "request(s) shown."),
      ),
  },
  {
    pattern: /^Shows at least one action result for the session\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, "[AGENT]"),
        requireRegex(actual, /(reload|goto)/, "reload or goto action"),
        requireIncludes(actual, "action(s) shown."),
      ),
  },
  {
    pattern: /^Explains that session "([^"]+)" does not exist, no active sessions are available, and suggests opening a session with libretto open <url> --session ([^".]+)\.$/,
    check: (actual, match) =>
      runChecks(
        actual,
        requireIncludes(actual, `No session "${match[1]!}" found.`),
        requireIncludes(actual, "No active sessions."),
        requireIncludes(actual, `libretto open <url> --session ${match[2]!}`),
      ),
  },
  {
    pattern: /^Lists one open page for example\.com and includes its page id\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, "Open pages:"),
        requireIncludes(actual, "example.com"),
        requireRegex(actual, /id=[^\s]+ url=/, "a page id"),
      ),
  },
  {
    pattern: /^Lists both the example\.com page and the data:text\/html,multi-page-secondary page, each with page ids\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, "example.com"),
        requireIncludes(actual, "data:text/html,multi-page-secondary"),
        requireRegex(actual, /id=[^\s]+ url=/, "page ids"),
      ),
  },
  {
    pattern: /^Explains that multiple pages are open in session "([^"]+)" and tells the user to pass --page <id> to target one page\.$/,
    check: (actual, match) =>
      runChecks(
        actual,
        requireIncludes(actual, `Multiple pages are open in session "${match[1]!}".`),
        requireIncludes(actual, "Pass --page <id> to target a page"),
      ),
  },
  {
    pattern: /^Explains that page id "([^"]+)" was not found in session "([^"]+)"\.$/,
    check: (actual, match) =>
      requireIncludes(actual, `Page "${match[1]!}" was not found in session "${match[2]!}".`),
  },
  {
    pattern: /^Explains that session "([^"]+)" is already open and suggests closing it or using a different session name\.$/,
    check: (actual, match) =>
      runChecks(
        actual,
        requireIncludes(actual, `Session "${match[1]!}" is already open and connected to`),
        requireIncludes(actual, `libretto close --session ${match[1]!}`),
      ),
  },
  {
    pattern: /^Includes AUTO_SESSION_RUN_OK and confirms the integration completed successfully\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, "AUTO_SESSION_RUN_OK"),
        requireIncludes(actual, "Integration completed."),
      ),
  },
  {
    pattern: /^Explains that the default session is missing, that no active sessions exist, and suggests starting one with "libretto open <url> --session default"\.$/,
    check: (actual) =>
      runChecks(
        actual,
        requireIncludes(actual, 'No session "default" found.'),
        requireIncludes(actual, "No active sessions."),
        requireIncludes(actual, "libretto open <url> --session default"),
      ),
  },
  {
    pattern: /^Explains that session "([^"]+)" is already open and suggests closing it or choosing another session\.$/,
    check: (actual, match) =>
      runChecks(
        actual,
        requireIncludes(actual, `Session "${match[1]!}" is already open and connected to`),
        requireIncludes(actual, `libretto close --session ${match[1]!}`),
      ),
  },
];

async function evaluateTextMatch(opts: {
  actual: string;
  assertion: string;
}): Promise<EvaluationResult> {
  const actual = normalizeOutput(opts.actual);
  for (const rule of EVALUATE_RULES) {
    const match = opts.assertion.match(rule.pattern);
    if (!match) continue;
    const failureReason = rule.check(actual, match);
    return {
      success: failureReason === null,
      reason: failureReason ?? "Matched local evaluate rule.",
      cached: false,
      model: EVALUATE_MODEL,
    };
  }

  return {
    success: false,
    reason: `No local evaluate rule matched assertion: ${opts.assertion}`,
    cached: false,
    model: EVALUATE_MODEL,
  };
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcessGroupOrPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch {}

  try {
    process.kill(pid, signal);
  } catch {}
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isPidRunning(pid);
}

function readWorkspaceSessionPids(workspaceDir: string): number[] {
  const sessionsDir = join(workspaceDir, ".libretto", "sessions");
  if (!existsSync(sessionsDir)) return [];

  const pids = new Set<number>();
  for (const entry of readdirSync(sessionsDir)) {
    const statePath = join(sessionsDir, entry, "state.json");
    if (!existsSync(statePath)) continue;
    try {
      const raw = JSON.parse(readFileSync(statePath, "utf8")) as { pid?: unknown };
      if (typeof raw.pid === "number" && Number.isFinite(raw.pid) && raw.pid > 0) {
        pids.add(raw.pid);
      }
    } catch {
      // Ignore unreadable test state during cleanup.
    }
  }

  return [...pids];
}

async function closeAllSessionsInWorkspace(workspaceDir: string): Promise<void> {
  const pids = readWorkspaceSessionPids(workspaceDir);
  if (pids.length === 0) return;

  for (const pid of pids) {
    signalProcessGroupOrPid(pid, "SIGTERM");
  }

  for (const pid of pids) {
    if (await waitForPidExit(pid, 1_500)) continue;
    signalProcessGroupOrPid(pid, "SIGKILL");
    await waitForPidExit(pid, 500);
  }
}

export const test = base.extend<CliFixtures>({
  workspaceDir: async ({ task }, use) => {
    const workspaceDir = workspaceDirForTask(task);
    await rm(workspaceDir, { recursive: true, force: true });
    await mkdir(workspaceDir, { recursive: true });
    try {
      await use(workspaceDir);
    } finally {
      try {
        await closeAllSessionsInWorkspace(workspaceDir);
      } catch {
        // Best-effort cleanup. Workspace removal still runs below.
      }
      await rm(workspaceDir, { recursive: true, force: true });
    }
  },

  workspacePath: async ({ workspaceDir }, use) => {
    await use((...parts: string[]) => join(workspaceDir, ...parts));
  },

  librettoRuntimePath: async ({}, use) => {
    await use(librettoRuntimePath);
  },

  librettoCli: async ({ workspaceDir }, use) => {
    ensureBuilt();
    await use(async (command: string, env?: Record<string, string>) => {
      return await execProcess(
        process.execPath,
        [cliEntry, ...parseCommandArgs(command)],
        workspaceDir,
        env,
      );
    });
  },

  evaluate: async ({}, use) => {
    await use((actual: string) => ({
      async toMatch(assertion: string): Promise<EvaluationResult> {
        const result = await evaluateTextMatch({
          actual,
          assertion,
        });
        if (!result.success) {
          throw new Error(result.reason);
        }
        return result;
      },
    }));
  },

  writeWorkflow: async ({ workspaceDir }, use) => {
    await use(async (fileName: string, source: string, imports?: string[]) => {
      const normalized = stripCodeFence(source);
      const scriptPath = join(workspaceDir, fileName);
      await writeFile(
        scriptPath,
        `${workflowImportHeader(imports)}${normalized}`,
        "utf8",
      );
      return scriptPath;
    });
  },

  writeWorkflowScript: async ({ workspacePath }, use) => {
    await use(async (fileName: string, source: string) => {
      const normalized = stripCodeFence(source);
      const scriptPath = workspacePath(fileName);
      await writeFile(scriptPath, normalized, "utf8");
      return scriptPath;
    });
  },

  seedSessionState: async ({ workspacePath }, use) => {
    await use(async (state?: Partial<SessionState>) => {
      const session = state?.session ?? "default";
      const normalized: SessionState = {
        session,
        port: state?.port ?? 9222,
        pid: state?.pid ?? 12345,
        startedAt: state?.startedAt ?? "2026-01-01T00:00:00.000Z",
        status: state?.status,
      };
      const dir = workspacePath(".libretto", "sessions", session);
      await mkdir(dir, { recursive: true });
      await writeFile(
        workspacePath(".libretto", "sessions", session, "state.json"),
        JSON.stringify(
          {
            version: SESSION_STATE_VERSION,
            ...normalized,
          },
          null,
          2,
        ),
      );
      return normalized;
    });
  },

  seedSessionPermission: async ({ workspacePath }, use) => {
    await use(async (session: string, mode: "read-only" | "full-access") => {
      const dir = workspacePath(".libretto");
      const path = workspacePath(".libretto", "config.json");
      await mkdir(dir, { recursive: true });
      let payload: Record<string, unknown> = { version: 1 };
      if (existsSync(path)) {
        payload = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      }
      payload.version = 1;
      payload.permissions = {
        sessions: {
          [session]: mode,
        },
      };
      await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
      return path;
    });
  },

  seedProfile: async ({ workspacePath }, use) => {
    await use(async (domain: string, sourcePath: string) => {
      const profileDir = workspacePath(".libretto", "profiles");
      await mkdir(profileDir, { recursive: true });
      const destPath = workspacePath(".libretto", "profiles", `${domain}.json`);
      await copyFile(sourcePath, destPath);
      return destPath;
    });
  },
});
