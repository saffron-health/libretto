import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  execFile,
  spawnSync,
} from "node:child_process";
import { fileURLToPath } from "node:url";
import { test as base } from "vitest";
import { SESSION_STATE_VERSION, type SessionState } from "../src/shared/state/index.js";

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
  ) => Promise<SpawnResult>;
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
};

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../../..");
const packageRoot = resolve(here, "..");
const cliEntry = resolve(packageRoot, "dist/cli/index.js");
const librettoEntry = resolve(packageRoot, "dist/index.js");
const librettoRuntimePath = new URL("../dist/index.js", import.meta.url)
  .href;

let didBuild = false;

function ensureBuilt(): void {
  if (didBuild && existsSync(cliEntry) && existsSync(librettoEntry)) return;
  if (existsSync(cliEntry) && existsSync(librettoEntry)) {
    didBuild = true;
    return;
  }
  const buildResult = spawnSync("pnpm", ["--filter", "libretto", "build"], {
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
});
