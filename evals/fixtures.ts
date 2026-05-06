import { cp, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { test as base } from "vitest";
import { PiEvalHarness } from "./harness.js";
import { createTmpWorkspace } from "@libretto/dev-tools/tmp-workspace";

type EvalFixtures = {
  harness: PiEvalHarness;
  repoRoot: string;
  evalWorkspaceDir: string;
  evalWorkspacePath: (...parts: string[]) => string;
  copyEvalReference: (
    sourceRelativePath: string,
    destinationRelativePath?: string,
  ) => Promise<string>;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");
const referencesRoot = resolve(repoRoot, "evals", "references");
const DETERMINISTIC_WORKSPACE_ROOT = join(tmpdir(), "libretto-eval-workspaces");

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

export const test = base.extend<EvalFixtures>({
  repoRoot: async ({}, use) => {
    await use(repoRoot);
  },
  evalWorkspaceDir: async ({ task }, use) => {
    const workspaceDir = workspaceDirForTask(task);
    await rm(workspaceDir, { recursive: true, force: true });
    await createTmpWorkspace({
      name: stableHash(`${task.file.filepath}::${task.fullName}`).slice(0, 16),
      parentDir: DETERMINISTIC_WORKSPACE_ROOT,
      skipBrowsers: true,
      skipBuild: true,
      quiet: true,
    });
    try {
      await use(workspaceDir);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  },

  evalWorkspacePath: async ({ evalWorkspaceDir }, use) => {
    await use((...parts: string[]) => join(evalWorkspaceDir, ...parts));
  },

  copyEvalReference: async ({ evalWorkspaceDir }, use) => {
    await use(
      async (sourceRelativePath: string, destinationRelativePath?: string) => {
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
    );
  },
  harness: async ({ evalWorkspaceDir }, use) => {
    const harness = new PiEvalHarness({
      cwd: evalWorkspaceDir,
      model: process.env.LIBRETTO_EVAL_MODEL?.trim() || undefined,
    });
    try {
      await use(harness);
    } finally {
      harness.dispose();
    }
  },
});

export { expect } from "vitest";
