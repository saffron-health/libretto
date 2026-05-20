import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PiEvalHarness } from "./harness.js";
import { createTmpWorkspace } from "@libretto/dev-tools/tmp-workspace";
import type { EvalCaseRecord } from "./eval-case.js";
import { provisionAuthProfile } from "./auth-profiles.js";
import {
  BrowserUseEvalAgent,
  LibrettoCachedEvalAgent,
  LibrettoEvalAgent,
  type EvalAgent,
  type EvalAgentName,
} from "./agents.js";

export type EvalContext = {
  agent: EvalAgent;
  agentName: EvalAgentName;
  harness: PiEvalHarness;
  repoRoot: string;
  evalWorkspaceDir: string;
  evalWorkspacePath: (...parts: string[]) => string;
  copyEvalReference: (
    sourceRelativePath: string,
    destinationRelativePath?: string,
  ) => Promise<string>;
  dispose: () => Promise<void>;
};

export type CreateEvalContextOptions = {
  agentName?: EvalAgentName;
  model?: string;
  provider?: string | null;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");
const referencesRoot = resolve(repoRoot, "evals", "references");
const DETERMINISTIC_WORKSPACE_ROOT = join(tmpdir(), "libretto-eval-workspaces");

function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function workspaceDirForCase(
  evalCase: EvalCaseRecord,
  agentName: EvalAgentName,
): string {
  const stableId = stableHash(
    `${evalCase.filePath ?? "unknown"}::${evalCase.name}::${agentName}`,
  ).slice(0, 16);
  return join(DETERMINISTIC_WORKSPACE_ROOT, stableId);
}

function assertWithinRoot(
  root: string,
  candidate: string,
  label: string,
): void {
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `${label} must stay within ${root}. Received: ${candidate}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readExistingLibrettoConfig(
  configPath: string,
): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : { version: 1 };
  } catch {
    return { version: 1 };
  }
}

export async function createEvalContext(
  evalCase: EvalCaseRecord,
  options: CreateEvalContextOptions = {},
): Promise<EvalContext> {
  const agentName = options.agentName ?? "libretto";
  const evalWorkspaceDir = workspaceDirForCase(evalCase, agentName);
  const workspaceName = stableHash(
    `${evalCase.filePath ?? "unknown"}::${evalCase.name}::${agentName}`,
  ).slice(0, 16);
  await rm(evalWorkspaceDir, { recursive: true, force: true });
  if (agentName !== "browser-use") {
    try {
      await createTmpWorkspace({
        name: workspaceName,
        parentDir: DETERMINISTIC_WORKSPACE_ROOT,
        skipBuild: true,
        extraPackages: ["zod@^4.3.6"],
        quiet: true,
      });
    } catch (error) {
      await rm(evalWorkspaceDir, { recursive: true, force: true });
      throw error;
    }
  } else {
    await mkdir(evalWorkspaceDir, { recursive: true });
  }

  if (evalCase.authProfile) {
    await provisionAuthProfile(evalCase.authProfile, evalWorkspaceDir);
  }

  if (options.provider) {
    const configDir = join(evalWorkspaceDir, ".libretto");
    const configPath = join(configDir, "config.json");
    await mkdir(configDir, { recursive: true });
    const config = await readExistingLibrettoConfig(configPath);
    await writeFile(
      configPath,
      `${JSON.stringify(
        { ...config, version: 1, provider: options.provider },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const harness = new PiEvalHarness({
    cwd: evalWorkspaceDir,
    model: options.model,
  });
  const browserProvider = options.provider ?? "local";
  const agent =
    agentName === "libretto"
      ? new LibrettoEvalAgent(harness, browserProvider)
      : agentName === "libretto-cached"
        ? new LibrettoCachedEvalAgent(browserProvider)
        : new BrowserUseEvalAgent({
            cwd: evalWorkspaceDir,
            model: options.model ?? "openai/gpt-5.5",
            browserProvider,
          });

  return {
    agent,
    agentName,
    harness,
    repoRoot,
    evalWorkspaceDir,
    evalWorkspacePath: (...parts: string[]) => join(evalWorkspaceDir, ...parts),
    copyEvalReference: async (
      sourceRelativePath: string,
      destinationRelativePath?: string,
    ) => {
      const sourcePath = resolve(referencesRoot, sourceRelativePath);
      assertWithinRoot(referencesRoot, sourcePath, "Reference source path");

      const targetRelative = destinationRelativePath ?? sourceRelativePath;
      const targetPath = resolve(evalWorkspaceDir, targetRelative);
      assertWithinRoot(
        evalWorkspaceDir,
        targetPath,
        "Workspace destination path",
      );

      await mkdir(dirname(targetPath), { recursive: true });
      await cp(sourcePath, targetPath, {
        recursive: true,
        force: true,
      });
      return targetPath;
    },
    dispose: async () => {
      agent.dispose();
      await rm(evalWorkspaceDir, { recursive: true, force: true });
    },
  };
}
