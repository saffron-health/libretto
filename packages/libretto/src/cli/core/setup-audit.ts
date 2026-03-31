import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "./context.js";

export type LibrettoSetupAuditIssue = {
  agentDirName: string;
  message: string;
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function findLibrettoPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  while (dir !== dirname(dir)) {
    const packageJsonPath = join(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = readJson(packageJsonPath) as { name?: unknown };
      if (packageJson.name === "libretto") {
        return dir;
      }
    }
    dir = dirname(dir);
  }

  throw new Error("Could not locate the installed libretto package root.");
}

function getInstalledLibrettoVersion(): string {
  const packageJson = readJson(join(findLibrettoPackageRoot(), "package.json")) as {
    version?: unknown;
  };

  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("Could not determine the installed libretto version.");
  }

  return packageJson.version;
}

function readSkillVersion(skillDir: string): string | null {
  const skillPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return null;

  const content = readFileSync(skillPath, "utf8");
  const match = content.match(/^\s*version:\s*"([^"\n]+)"/m);
  return match?.[1] ?? null;
}

function detectAgentSkillDirs(root: string): string[] {
  const dirs: string[] = [];
  const agentsSkillsDir = join(root, ".agents", "skills");
  const claudeSkillsDir = join(root, ".claude", "skills");
  if (existsSync(agentsSkillsDir)) dirs.push(agentsSkillsDir);
  if (existsSync(claudeSkillsDir)) dirs.push(claudeSkillsDir);
  return dirs;
}

export function auditLibrettoSetup(
  repoRoot: string = REPO_ROOT,
  installedVersion: string = getInstalledLibrettoVersion(),
): LibrettoSetupAuditIssue[] {
  const agentSkillDirs = detectAgentSkillDirs(repoRoot);
  if (agentSkillDirs.length === 0) {
    return [];
  }

  const issues: LibrettoSetupAuditIssue[] = [];

  for (const agentSkillsDir of agentSkillDirs) {
    const agentDirName = basename(dirname(agentSkillsDir));
    const skillDir = join(agentSkillsDir, "libretto");
    const skillVersion = readSkillVersion(skillDir);

    if (!existsSync(skillDir)) {
      issues.push({
        agentDirName,
        message: `Missing ${agentDirName}/skills/libretto/.`,
      });
      continue;
    }

    if (!skillVersion) {
      issues.push({
        agentDirName,
        message: `Could not determine the version in ${agentDirName}/skills/libretto/SKILL.md.`,
      });
      continue;
    }

    if (skillVersion !== installedVersion) {
      issues.push({
        agentDirName,
        message: `${agentDirName}/skills/libretto is v${skillVersion}, but installed libretto is v${installedVersion}.`,
      });
    }
  }

  return issues;
}

let didWarnForCurrentProcess = false;

export function warnIfSetupAuditIssues(repoRoot: string = REPO_ROOT): void {
  if (didWarnForCurrentProcess) {
    return;
  }

  try {
    const issues = auditLibrettoSetup(repoRoot);
    if (issues.length === 0) {
      return;
    }

    didWarnForCurrentProcess = true;
    console.warn("Warning: Libretto setup looks stale.");
    for (const issue of issues) {
      console.warn(`  - ${issue.message}`);
    }
    console.warn("Run: npx libretto setup");
  } catch {
    // Setup audit warnings should never block runtime commands.
  }
}
