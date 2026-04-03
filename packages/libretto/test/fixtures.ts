import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test as base } from "vitest";
import {
  SESSION_STATE_VERSION,
  type SessionAccessMode,
  type SessionState,
} from "../src/shared/state/index.js";

type SpawnResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CliFixtures = {
  workspaceDir: string;
  workspacePath: (...parts: string[]) => string;
  librettoRuntimePath: string;
  librettoCli: (
    command: string,
    env?: Record<string, string>,
    stdinText?: string,
  ) => Promise<SpawnResult>;
  writeWorkflow: (
    fileName: string,
    source: string,
    imports?: string[],
  ) => Promise<string>;
  writeWorkflowScript: (fileName: string, source: string) => Promise<string>;
  seedSessionState: (state?: Partial<SessionState>) => Promise<SessionState>;
  seedSessionMode: (session: string, mode: SessionAccessMode) => Promise<string>;
  seedProfile: (domain: string, sourcePath: string) => Promise<string>;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");
const packageRoot = repoRoot;
const cliEntry = resolve(packageRoot, "dist/cli/index.js");
const librettoEntry = resolve(packageRoot, "dist/index.js");
const librettoRuntimePath = new URL("../dist/index.js", import.meta.url).href;
const DETERMINISTIC_WORKSPACE_ROOT = join(tmpdir(), "libretto-test-workspaces");

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
  stdinText?: string,
): Promise<SpawnResult> {
  return await new Promise<SpawnResult>((resolveResult, reject) => {
    const child = execFile(
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

    if (stdinText !== undefined) {
      child.stdin?.end(stdinText);
    }
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

function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function workspaceDirForTask(
  task: Readonly<{ fullName: string; file: { filepath: string } }>,
): string {
  const stableId = stableHash(`${task.file.filepath}::${task.fullName}`).slice(
    0,
    16,
  );
  return join(DETERMINISTIC_WORKSPACE_ROOT, stableId);
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

async function waitForPidExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
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
      const raw = JSON.parse(readFileSync(statePath, "utf8")) as {
        pid?: unknown;
      };
      if (
        typeof raw.pid === "number" &&
        Number.isFinite(raw.pid) &&
        raw.pid > 0
      ) {
        pids.add(raw.pid);
      }
    } catch {
      // Ignore unreadable test state during cleanup.
    }
  }

  return [...pids];
}

async function closeAllSessionsInWorkspace(
  workspaceDir: string,
): Promise<void> {
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
    await use(
      async (
        command: string,
        env?: Record<string, string>,
        stdinText?: string,
      ) => {
        return await execProcess(
          process.execPath,
          [cliEntry, ...parseCommandArgs(command)],
          workspaceDir,
          env,
          stdinText,
        );
      },
    );
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
      const session = state?.session ?? "test-session";
      const normalized: SessionState = {
        session,
        port: state?.port ?? 9222,
        pid: state?.pid ?? 12345,
        startedAt: state?.startedAt ?? "2026-01-01T00:00:00.000Z",
        mode: state?.mode ?? "write-access",
        status: state?.status,
        cdpEndpoint: state?.cdpEndpoint,
        viewport: state?.viewport,
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

  seedSessionMode: async ({ workspacePath }, use) => {
    await use(async (session: string, mode: SessionAccessMode) => {
      const dir = workspacePath(".libretto", "sessions", session);
      const path = workspacePath(".libretto", "sessions", session, "state.json");
      await mkdir(dir, { recursive: true });

      let payload: SessionState = {
        session,
        port: 9222,
        pid: 12345,
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "active",
        mode: "write-access",
      };

      if (existsSync(path)) {
        payload = JSON.parse(await readFile(path, "utf8")) as SessionState;
      }

      payload.mode = mode;
      await writeFile(
        path,
        JSON.stringify(
          {
            version: SESSION_STATE_VERSION,
            ...payload,
          },
          null,
          2,
        ),
        "utf8",
      );
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
