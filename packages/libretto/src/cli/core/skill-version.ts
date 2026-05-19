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

function readPackageVersion(packageJsonPath: string): string | null {
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  const manifest = JSON.parse(
    readFileSync(packageJsonPath, "utf8"),
  ) as PackageManifest;
  return manifest.version?.trim() || null;
}

export function readCurrentCliVersion(): string {
  if (cachedCliVersion) {
    return cachedCliVersion;
  }

  const packageJsonPath = fileURLToPath(
    new URL("../../../package.json", import.meta.url),
  );
  const version = readPackageVersion(packageJsonPath);

  if (!version) {
    throw new Error(
      `Unable to determine current libretto version from ${packageJsonPath}.`,
    );
  }

  cachedCliVersion = version;
  return cachedCliVersion;
}

function readLocalPackageVersion(): string | null {
  return readPackageVersion(
    join(REPO_ROOT, "node_modules", "libretto", "package.json"),
  );
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

function readInstalledSkillVersions(): string[] {
  const versions = new Set<string>();

  for (const relativePathParts of INSTALLED_SKILL_PATHS) {
    const skillPath = join(REPO_ROOT, ...relativePathParts);
    const installedVersion = readInstalledSkillVersion(skillPath);
    if (installedVersion) {
      versions.add(installedVersion);
    }
  }

  return [...versions];
}

function formatObservedVersions(components: {
  cliVersion: string;
  localPackageVersion: string | null;
  skillVersions: string[];
}): string {
  const labels = [`global CLI ${components.cliVersion}`];

  if (components.localPackageVersion) {
    labels.push(`local package ${components.localPackageVersion}`);
  }

  if (components.skillVersions.length === 1) {
    labels.push(`agent skill ${components.skillVersions[0]}`);
  } else if (components.skillVersions.length > 1) {
    labels.push(`agent skills ${components.skillVersions.join(", ")}`);
  }

  return labels.join(", ");
}

export function warnIfLibrettoVersionsDiffer(): void {
  try {
    const cliVersion = readCurrentCliVersion();
    const localPackageVersion = readLocalPackageVersion();
    const skillVersions = readInstalledSkillVersions();
    const observedVersions = new Set([
      cliVersion,
      ...(localPackageVersion ? [localPackageVersion] : []),
      ...skillVersions,
    ]);

    if (observedVersions.size <= 1) {
      return;
    }

    console.error(
      `Warning: Libretto versions differ: ${formatObservedVersions({
        cliVersion,
        localPackageVersion,
        skillVersions,
      })}. Use the same Libretto version globally and locally; run \`libretto setup\` after changing versions.`,
    );
  } catch {
    // Never block command execution on a best-effort skill version check.
  }
}
