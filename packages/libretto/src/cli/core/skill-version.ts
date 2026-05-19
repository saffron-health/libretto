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

function formatSkillVersions(
  versions: string[],
): string {
  if (versions.length === 0) {
    return "not installed";
  }

  return versions.join(", ");
}

function formatVersionWarning(components: {
  cliVersion: string;
  localPackageVersion: string | null;
  skillVersions: string[];
}): string {
  const skillLabel =
    components.skillVersions.length > 1 ? "agent skills" : "agent skill";

  return [
    "WARNING: Libretto skill version does not match the local package.",
    `  local package: ${
      components.localPackageVersion ?? `${components.cliVersion}  (current command)`
    }`,
    `  ${skillLabel}:   ${formatSkillVersions(components.skillVersions)}`,
    "Fix: run libretto setup",
  ].join("\n");
}

export function warnIfLibrettoVersionsDiffer(): void {
  try {
    const cliVersion = readCurrentCliVersion();
    const localPackageVersion = readLocalPackageVersion();
    const packageVersion = localPackageVersion ?? cliVersion;
    const skillVersions = readInstalledSkillVersions();
    if (
      skillVersions.length === 0 ||
      skillVersions.every((skillVersion) => skillVersion === packageVersion)
    ) {
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
