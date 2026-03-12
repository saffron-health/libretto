import {
  cp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { test as base } from "vitest";
import { ClaudeEvalHarness, ensureClaudeAuthConfigured } from "./harness.js";

type EvalFixtures = {
  harness: ClaudeEvalHarness;
  repoRoot: string;
  packageRoot: string;
  evalWorkspaceDir: string;
  evalWorkspacePath: (...parts: string[]) => string;
  copyEvalReference: (
    sourceRelativePath: string,
    destinationRelativePath?: string,
  ) => Promise<string>;
  writeEvalFile: (destinationRelativePath: string, source: string) => Promise<string>;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = packageRoot;
const skillPath = resolve(packageRoot, ".agents/skills/libretto/SKILL.md");
const referencesRoot = resolve(packageRoot, "evals/references");
const DETERMINISTIC_WORKSPACE_ROOT = join(tmpdir(), "libretto-eval-workspaces");

let cachedSkillMarkdown: string | null = null;

async function getSkillMarkdown(): Promise<string> {
  if (cachedSkillMarkdown !== null) return cachedSkillMarkdown;
  cachedSkillMarkdown = await readFile(skillPath, "utf8");
  return cachedSkillMarkdown;
}

function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function workspaceDirForTask(task: Readonly<{ fullName: string; file: { filepath: string } }>): string {
  const stableId = stableHash(`${task.file.filepath}::${task.fullName}`).slice(0, 16);
  return join(DETERMINISTIC_WORKSPACE_ROOT, stableId);
}

function assertWithinRoot(root: string, candidate: string, label: string): void {
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${label} must stay within ${root}. Received: ${candidate}`);
  }
}

async function setupWorkspacePackage(workspaceDir: string): Promise<void> {
  const workspacePackagePath = join(workspaceDir, "package.json");
  const workspacePackageJson = {
    name: "libretto-eval-workspace",
    private: true,
    type: "module",
  };
  await writeFile(
    workspacePackagePath,
    `${JSON.stringify(workspacePackageJson, null, 2)}\n`,
    "utf8",
  );

  const nodeModulesPath = join(workspaceDir, "node_modules");
  const librettoLinkPath = join(nodeModulesPath, "libretto");
  await mkdir(nodeModulesPath, { recursive: true });
  await rm(librettoLinkPath, { recursive: true, force: true });
  await symlink(packageRoot, librettoLinkPath, "dir");
}

export const test = base.extend<EvalFixtures>({
  repoRoot: async ({}, use) => {
    await use(repoRoot);
  },

  packageRoot: async ({}, use) => {
    await use(packageRoot);
  },

  evalWorkspaceDir: async ({ task }, use) => {
    const workspaceDir = workspaceDirForTask(task);
    await rm(workspaceDir, { recursive: true, force: true });
    await mkdir(workspaceDir, { recursive: true });
    await setupWorkspacePackage(workspaceDir);
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
    await use(async (sourceRelativePath: string, destinationRelativePath?: string) => {
      const sourcePath = resolve(referencesRoot, sourceRelativePath);
      assertWithinRoot(referencesRoot, sourcePath, "Reference source path");

      const targetRelative = destinationRelativePath ?? sourceRelativePath;
      const targetPath = resolve(evalWorkspaceDir, targetRelative);
      assertWithinRoot(evalWorkspaceDir, targetPath, "Workspace destination path");

      await mkdir(dirname(targetPath), { recursive: true });
      await cp(sourcePath, targetPath, {
        recursive: true,
        force: true,
      });
      return targetPath;
    });
  },

  writeEvalFile: async ({ evalWorkspaceDir }, use) => {
    await use(async (destinationRelativePath: string, source: string) => {
      const destinationPath = resolve(evalWorkspaceDir, destinationRelativePath);
      assertWithinRoot(evalWorkspaceDir, destinationPath, "Workspace write path");
      await mkdir(dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, source, "utf8");
      return destinationPath;
    });
  },

  harness: async ({ evalWorkspaceDir }, use) => {
    ensureClaudeAuthConfigured();
    const harness = new ClaudeEvalHarness({
      cwd: evalWorkspaceDir,
      model: process.env.LIBRETTO_EVAL_MODEL?.trim() || undefined,
      librettoSkillMarkdown: await getSkillMarkdown(),
    });
    try {
      await use(harness);
    } finally {
      await harness.close();
    }
  },
});

export { expect } from "vitest";
