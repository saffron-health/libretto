import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test as base } from "vitest";

type SessionState = {
  port: number;
  pid: number;
  session: string;
  runId: string;
  startedAt: string;
  mode?: "read-only" | "interactive";
};

type JsonRecord = Record<string, unknown>;

type SpawnResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type SeedHelpers = {
  seedSessionState: (state?: Partial<SessionState>) => Promise<SessionState>;
  seedSessionPermission: (
    session: string,
    mode: "read-only" | "interactive",
  ) => Promise<string>;
  seedSnapshotConfig: (config?: JsonRecord) => Promise<string>;
  seedNetworkLog: (runId: string, entries: JsonRecord[]) => Promise<string>;
  seedActionLog: (runId: string, entries: JsonRecord[]) => Promise<string>;
};

type CliFixtures = {
  workspaceDir: string;
  workspacePath: (...parts: string[]) => string;
  librettoCli: (
    command: string,
    env?: Record<string, string>,
  ) => Promise<SpawnResult>;
} & SeedHelpers;

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../../..");
const cliEntry = resolve(repoRoot, "packages/libretto-cli/dist/index.js");
const librettoEntry = resolve(repoRoot, "packages/libretto/dist/index.js");

let didBuild = false;

function ensureBuilt(): void {
  if (didBuild && existsSync(cliEntry) && existsSync(librettoEntry)) return;
  if (existsSync(cliEntry) && existsSync(librettoEntry)) {
    didBuild = true;
    return;
  }
  const buildLibretto = spawnSync("pnpm", ["--filter", "libretto", "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (buildLibretto.status !== 0) {
    throw new Error(
      `Failed to build libretto before CLI tests.\n${buildLibretto.stdout}\n${buildLibretto.stderr}`,
    );
  }
  const buildCli = spawnSync("pnpm", ["--filter", "libretto-cli", "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (buildCli.status !== 0) {
    throw new Error(
      `Failed to build libretto-cli before tests.\n${buildCli.stdout}\n${buildCli.stderr}`,
    );
  }
  didBuild = true;
}

async function spawnProcess(
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<SpawnResult> {
  return await new Promise<SpawnResult>((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolveResult({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
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

export const test = base.extend<CliFixtures>({
  workspaceDir: async ({}, use) => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "libretto-cli-test-"));
    try {
      await use(workspaceDir);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  },

  workspacePath: async ({ workspaceDir }, use) => {
    await use((...parts: string[]) => join(workspaceDir, ...parts));
  },

  librettoCli: async ({ workspaceDir }, use) => {
    ensureBuilt();
    await use(async (command: string, env?: Record<string, string>) => {
      return await spawnProcess(
        process.execPath,
        [cliEntry, ...parseCommandArgs(command)],
        workspaceDir,
        env,
      );
    });
  },

  seedSessionState: async ({ workspacePath }, use) => {
    await use(async (state?: Partial<SessionState>) => {
      const session = state?.session ?? "default";
      const normalized: SessionState = {
        session,
        runId: state?.runId ?? "run-seeded",
        port: state?.port ?? 9222,
        pid: state?.pid ?? 12345,
        startedAt: state?.startedAt ?? "2026-01-01T00:00:00.000Z",
        mode: state?.mode,
      };
      const dir = workspacePath("tmp", "libretto-cli");
      await mkdir(dir, { recursive: true });
      await writeFile(
        workspacePath("tmp", "libretto-cli", `${session}.json`),
        JSON.stringify(normalized, null, 2),
      );
      return normalized;
    });
  },

  seedSnapshotConfig: async ({ workspacePath }, use) => {
    await use(async (config?: JsonRecord) => {
      const dir = workspacePath(".libretto");
      const path = workspacePath(".libretto", "config.json");
      await mkdir(dir, { recursive: true });
      const payload = config ?? {
        version: 1,
        ai: {
          preset: "codex",
          commandPrefix: ["codex", "exec"],
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      };
      await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
      return path;
    });
  },

  seedSessionPermission: async ({ workspacePath }, use) => {
    await use(async (session: string, mode: "read-only" | "interactive") => {
      const dir = workspacePath(".libretto-cli");
      const path = workspacePath(".libretto-cli", "session-permissions.json");
      await mkdir(dir, { recursive: true });
      const payload = {
        version: 1,
        sessions: {
          [session]: mode,
        },
      };
      await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
      return path;
    });
  },

  seedNetworkLog: async ({ workspacePath }, use) => {
    await use(async (runId: string, entries: JsonRecord[]) => {
      const runDir = workspacePath("tmp", "libretto-cli", runId);
      const logPath = workspacePath("tmp", "libretto-cli", runId, "network.jsonl");
      await mkdir(runDir, { recursive: true });
      const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
      await writeFile(logPath, body ? `${body}\n` : "", "utf8");
      return logPath;
    });
  },

  seedActionLog: async ({ workspacePath }, use) => {
    await use(async (runId: string, entries: JsonRecord[]) => {
      const runDir = workspacePath("tmp", "libretto-cli", runId);
      const logPath = workspacePath("tmp", "libretto-cli", runId, "actions.jsonl");
      await mkdir(runDir, { recursive: true });
      const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
      await writeFile(logPath, body ? `${body}\n` : "", "utf8");
      return logPath;
    });
  },
});
