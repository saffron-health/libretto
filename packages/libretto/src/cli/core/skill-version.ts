import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "./context.js";

type PackageManifest = {
  version?: string;
};

const INSTALLED_SKILL_PATHS = [
  [".agents", "skills", "libretto", "SKILL.md"],
  [".claude", "skills", "libretto", "SKILL.md"],
] as const;

let cachedCliVersion: string | null = null;

function readCurrentCliVersion(): string {
  if (cachedCliVersion) {
    return cachedCliVersion;
  }

  const packageJsonPath = fileURLToPath(
    new URL("../../../package.json", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(packageJsonPath, "utf8"),
  ) as PackageManifest;

  if (!manifest.version) {
    throw new Error(
      `Unable to determine current libretto version from ${packageJsonPath}.`,
    );
  }

  cachedCliVersion = manifest.version;
  return cachedCliVersion;
}

function readInstalledSkillVersion(skillPath: string): string | null {
  if (!existsSync(skillPath)) {
    return null;
  }

  const contents = readFileSync(skillPath, "utf8");
  const frontmatterMatch = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const metadataBlock = frontmatterMatch[1].match(
    /^metadata:\s*\r?\n((?:[ \t]+.*(?:\r?\n|$))*)/m,
  )?.[1];
  if (!metadataBlock) {
    return null;
  }

  const versionMatch = metadataBlock.match(
    /^[ \t]+version:\s*["']?([^"'\r\n]+)["']?\s*$/m,
  );
  return versionMatch?.[1]?.trim() ?? null;
}

function findInstalledSkillVersionMismatch(): {
  installedVersion: string;
  cliVersion: string;
} | null {
  const cliVersion = readCurrentCliVersion();

  for (const relativePathParts of INSTALLED_SKILL_PATHS) {
    const skillPath = join(REPO_ROOT, ...relativePathParts);
    const installedVersion = readInstalledSkillVersion(skillPath);
    if (installedVersion && installedVersion !== cliVersion) {
      return { installedVersion, cliVersion };
    }
  }

  return null;
}

export function warnIfInstalledSkillOutOfDate(): void {
  try {
    const mismatch = findInstalledSkillVersionMismatch();
    if (!mismatch) {
      return;
    }

    console.error(
      `Warning: Your agent skill (${mismatch.installedVersion}) is out of date with your Libretto CLI (${mismatch.cliVersion}). Please run \`npx libretto setup\` to update your skills to the correct version.`,
    );
  } catch {
    // Never block command execution on a best-effort skill version check.
  }
}
