import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  execFile,
  spawnSync,
} from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { z } from "zod";
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
};

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");
const packageRoot = repoRoot;
const cliEntry = resolve(packageRoot, "dist/cli/index.js");
const librettoEntry = resolve(packageRoot, "dist/index.js");
const librettoRuntimePath = new URL("../dist/index.js", import.meta.url)
  .href;
const EVALUATE_GCP_PROJECT = "saffron-health";
const EVALUATE_OPENAI_API_KEY_SECRET_NAME = "libretto-test-openai-api-key";
const EVALUATE_OPENAI_BASE_URL = "https://api.openai.com/v1";
const EVALUATE_MODEL = process.env.LIBRETTO_EVALUATE_MODEL?.trim() || "gpt-5-mini";
const EVALUATE_CACHE_DIR = resolve(repoRoot, "temp/libretto-cli-evaluate-cache");
const DETERMINISTIC_WORKSPACE_ROOT = join(tmpdir(), "libretto-cli-test-workspaces");
const EVALUATE_PROMPT_VERSION = 1;
const EVALUATE_MAX_ACTUAL_CHARS = 12_000;
const EvaluateVerdictSchema = z.object({
  success: z.boolean(),
  reason: z.string().trim().min(1),
});
const CachedEvaluationSchema = EvaluateVerdictSchema.extend({
  model: z.string().min(1),
});

function getSecret(secretName: string): string {
  const result = spawnSync(
    "gcloud",
    [
      "secrets",
      "versions",
      "access",
      "latest",
      `--project=${EVALUATE_GCP_PROJECT}`,
      `--secret=${secretName}`,
    ],
    { encoding: "utf8" },
  );
  if (result.status === 0 && result.stdout.trim().length > 0) {
    return result.stdout.trim();
  }
  return "";
}

const EVALUATE_OPENAI_API_KEY = getSecret(EVALUATE_OPENAI_API_KEY_SECRET_NAME);

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

function evaluateCachePath(cacheKey: string): string {
  return join(EVALUATE_CACHE_DIR, `${stableEvaluateHash(cacheKey)}.json`);
}

function workspaceDirForTask(task: Readonly<{ fullName: string; file: { filepath: string } }>): string {
  const stableId = stableEvaluateHash(`${task.file.filepath}::${task.fullName}`).slice(0, 16);
  return join(DETERMINISTIC_WORKSPACE_ROOT, stableId);
}

async function readEvaluateCache(
  cacheKey: string,
): Promise<Omit<EvaluationResult, "cached"> | null> {
  const path = evaluateCachePath(cacheKey);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    const parsed = CachedEvaluationSchema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }
    return {
      success: parsed.data.success,
      reason: parsed.data.reason,
      model: parsed.data.model,
    };
  } catch {
    return null;
  }
}

async function writeEvaluateCache(
  cacheKey: string,
  value: Omit<EvaluationResult, "cached">,
): Promise<void> {
  const path = evaluateCachePath(cacheKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

function clipActualForPrompt(actual: string): string {
  if (actual.length === 0) {
    return "[Empty string]";
  }
  if (!Number.isFinite(EVALUATE_MAX_ACTUAL_CHARS) || EVALUATE_MAX_ACTUAL_CHARS < 200) {
    return actual;
  }
  if (actual.length <= EVALUATE_MAX_ACTUAL_CHARS) return actual;
  const tailNotice = `\n\n[truncated to first ${EVALUATE_MAX_ACTUAL_CHARS} chars]`;
  return `${actual.slice(0, EVALUATE_MAX_ACTUAL_CHARS)}${tailNotice}`;
}

async function runEvaluateJudge(opts: {
  actual: string;
  assertion: string;
}): Promise<Omit<EvaluationResult, "cached">> {
  if (!EVALUATE_OPENAI_API_KEY) {
    throw new Error(
      `evaluate could not load OpenAI key from gcloud secret "${EVALUATE_OPENAI_API_KEY_SECRET_NAME}".`,
    );
  }

  const client = new OpenAI({
    apiKey: EVALUATE_OPENAI_API_KEY,
    baseURL: EVALUATE_OPENAI_BASE_URL,
  });
  const completion = await client.chat.completions.create({
    model: EVALUATE_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a strict test assertion grader. Return only JSON with keys success:boolean and reason:string. Mark success=false when evidence is insufficient.",
      },
      {
        role: "user",
        content: [
          "Decide whether ACTUAL_TEXT satisfies ASSERTION.",
          "Ignore minor formatting differences unless ASSERTION explicitly depends on formatting.",
          "Use one concise reason with direct evidence.",
          "",
          `ASSERTION:\n${opts.assertion}`,
          "",
          `ACTUAL_TEXT:\n${clipActualForPrompt(opts.actual)}`,
        ].join("\n"),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("evaluate received empty model content.");
  }

  let output: unknown;
  try {
    output = JSON.parse(content);
  } catch {
    throw new Error(`evaluate model output was not valid JSON: ${content.slice(0, 600)}`);
  }

  const parsedVerdict = EvaluateVerdictSchema.safeParse(output);
  if (!parsedVerdict.success) {
    throw new Error(
      `evaluate model output failed schema validation: ${parsedVerdict.error.issues[0]?.message ?? "unknown schema error"}`,
    );
  }

  return {
    success: parsedVerdict.data.success,
    reason: parsedVerdict.data.reason,
    model: EVALUATE_MODEL,
  };
}

async function evaluateTextMatch(opts: {
  actual: string;
  assertion: string;
}): Promise<EvaluationResult> {
  const cacheKey = JSON.stringify({
    version: EVALUATE_PROMPT_VERSION,
    model: EVALUATE_MODEL,
    assertion: opts.assertion,
    actual: opts.actual,
  });
  const cached = await readEvaluateCache(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }
  const fresh = await runEvaluateJudge(opts);
  await writeEvaluateCache(cacheKey, fresh);
  return { ...fresh, cached: false };
}

async function closeAllSessionsInWorkspace(workspaceDir: string): Promise<void> {
  if (!existsSync(cliEntry)) return;
  const closeAll = await execProcess(
    process.execPath,
    [cliEntry, "close", "--all"],
    workspaceDir,
  );
  if (closeAll.exitCode === 0) return;
  await execProcess(
    process.execPath,
    [cliEntry, "close", "--all", "--force"],
    workspaceDir,
  );
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
});
