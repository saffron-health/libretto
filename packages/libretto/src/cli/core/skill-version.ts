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

function parseVersion(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
} | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function compareVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) {
    return left.localeCompare(right);
  }

  for (const key of ["major", "minor", "patch"] as const) {
    const diff = parsedLeft[key] - parsedRight[key];
    if (diff !== 0) {
      return diff;
    }
  }

  if (parsedLeft.prerelease === parsedRight.prerelease) {
    return 0;
  }
  if (parsedLeft.prerelease === null) {
    return 1;
  }
  if (parsedRight.prerelease === null) {
    return -1;
  }
  return parsedLeft.prerelease.localeCompare(parsedRight.prerelease);
}

function selectTargetVersion(versions: string[]): string {
  const counts = new Map<string, number>();
  for (const version of versions) {
    counts.set(version, (counts.get(version) ?? 0) + 1);
  }

  const byCountThenVersion = [...counts.entries()].sort(
    ([leftVersion, leftCount], [rightVersion, rightCount]) =>
      rightCount - leftCount || compareVersions(rightVersion, leftVersion),
  );

  return byCountThenVersion[0]?.[0] ?? versions[0] ?? "latest";
}

function formatVersion(version: string, targetVersion: string): string {
  return version === targetVersion ? version : `${version}  (out of date)`;
}

function formatSkillVersions(
  versions: string[],
  targetVersion: string,
): string {
  if (versions.length === 0) {
    return "not installed";
  }

  return versions
    .map((version) => formatVersion(version, targetVersion))
    .join(", ");
}

function formatVersionWarning(components: {
  cliVersion: string;
  localPackageVersion: string | null;
  skillVersions: string[];
}): string {
  const targetVersion = selectTargetVersion([
    components.cliVersion,
    ...(components.localPackageVersion ? [components.localPackageVersion] : []),
    ...components.skillVersions,
  ]);
  const skillLabel =
    components.skillVersions.length > 1 ? "agent skills" : "agent skill";

  return [
    "WARNING: Libretto version mismatch detected.",
    "",
    `  global CLI:    ${formatVersion(components.cliVersion, targetVersion)}`,
    `  local package: ${
      components.localPackageVersion
        ? formatVersion(components.localPackageVersion, targetVersion)
        : "not installed"
    }`,
    `  ${skillLabel}:   ${formatSkillVersions(
      components.skillVersions,
      targetVersion,
    )}`,
    "",
    "How to update:",
    `  global CLI:    curl -fsSL https://libretto.sh/install.sh | LIBRETTO_VERSION=${targetVersion} bash`,
    `  local package: npm install libretto@${targetVersion}`,
    "  agent skill:   libretto setup",
  ].join("\n");
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
      formatVersionWarning({
        cliVersion,
        localPackageVersion,
        skillVersions,
      }),
    );
  } catch {
    // Never block command execution on a best-effort skill version check.
  }
}
