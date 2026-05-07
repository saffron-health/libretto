import { createHash } from "node:crypto";
import { cp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PiEvalHarness } from "./harness.js";
import { createTmpWorkspace } from "@libretto/dev-tools/tmp-workspace";
import type { EvalCaseRecord } from "./eval-case.js";
import { provisionAuthProfile } from "./auth-profiles.js";

export type EvalContext = {
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
  model?: string;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");
const referencesRoot = resolve(repoRoot, "evals", "references");
const DETERMINISTIC_WORKSPACE_ROOT = join(tmpdir(), "libretto-eval-workspaces");

function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function workspaceDirForCase(evalCase: EvalCaseRecord): string {
  const stableId = stableHash(
    `${evalCase.filePath ?? "unknown"}::${evalCase.name}`,
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

export async function createEvalContext(
  evalCase: EvalCaseRecord,
  options: CreateEvalContextOptions = {},
): Promise<EvalContext> {
  const evalWorkspaceDir = workspaceDirForCase(evalCase);
  const workspaceName = stableHash(
    `${evalCase.filePath ?? "unknown"}::${evalCase.name}`,
  ).slice(0, 16);
  await rm(evalWorkspaceDir, { recursive: true, force: true });
  try {
    await createTmpWorkspace({
      name: workspaceName,
      parentDir: DETERMINISTIC_WORKSPACE_ROOT,
      skipBrowsers: true,
      skipBuild: true,
      quiet: true,
    });
  } catch (error) {
    await rm(evalWorkspaceDir, { recursive: true, force: true });
    throw error;
  }

  if (evalCase.authProfile) {
    await provisionAuthProfile(evalCase.authProfile, evalWorkspaceDir);
  }

  const harness = new PiEvalHarness({
    cwd: evalWorkspaceDir,
    model: options.model,
  });

  return {
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
      harness.dispose();
      await rm(evalWorkspaceDir, { recursive: true, force: true });
    },
  };
}
