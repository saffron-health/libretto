import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSnapshotEnv,
  printSnapshotApiStatus,
  runInteractiveApiSetup,
} from "./snapshot.js";

type ParsedArgs = {
  skipBrowsers: boolean;
  help: boolean;
};

type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

type ProjectManifest = {
  packageManager?: string;
  workspaces?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type InstalledLibrettoInfo = {
  packageRoot: string;
  version: string;
};

const LIBRETTO_GITIGNORE_CONTENT = [
  "# Local libretto runtime state",
  "sessions/",
  "profiles/",
  "",
].join("\n");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    skipBrowsers: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--skip-browsers") {
      parsed.skipBrowsers = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

export function renderHelp(): string {
  return `Bootstrap Libretto into the current project.

Usage:
  npm init libretto@latest
  npm init libretto@latest -- --skip-browsers
  npm create libretto@latest
  create-libretto [--skip-browsers]

Options:
  --skip-browsers  Skip Playwright Chromium installation

Rerun setup later with:
  npx libretto setup
`;
}

function getCreateLibrettoVersion(): string {
  const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));
  return readJson<{ version: string }>(packageJsonPath).version;
}

function resolveRepoRoot(cwd: string = process.cwd()): string {
  const override = process.env.LIBRETTO_REPO_ROOT?.trim();
  if (override) {
    return resolve(override);
  }

  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });

  return result.status === 0 && result.stdout ? result.stdout.trim() : cwd;
}

function readManifest(repoRoot: string): ProjectManifest {
  const packageJsonPath = join(repoRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `No package.json found at ${repoRoot}. Run npm init libretto@latest from the root of a Node project.`,
    );
  }

  return readJson<ProjectManifest>(packageJsonPath);
}

function isWorkspaceRoot(repoRoot: string, manifest: ProjectManifest): boolean {
  return (
    existsSync(join(repoRoot, "pnpm-workspace.yaml")) ||
    Boolean(manifest.workspaces)
  );
}

function detectPackageManager(
  repoRoot: string,
  manifest: ProjectManifest,
): PackageManager {
  const fromPackageField =
    typeof manifest.packageManager === "string"
      ? manifest.packageManager.split("@")[0]
      : null;

  if (
    fromPackageField === "pnpm" ||
    fromPackageField === "yarn" ||
    fromPackageField === "bun" ||
    fromPackageField === "npm"
  ) {
    return fromPackageField;
  }

  if (existsSync(join(repoRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repoRoot, "yarn.lock"))) return "yarn";
  if (
    existsSync(join(repoRoot, "bun.lockb")) ||
    existsSync(join(repoRoot, "bun.lock"))
  ) {
    return "bun";
  }
  if (
    existsSync(join(repoRoot, "package-lock.json")) ||
    existsSync(join(repoRoot, "npm-shrinkwrap.json"))
  ) {
    return "npm";
  }

  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("yarn/")) return "yarn";
  if (userAgent.startsWith("bun/")) return "bun";
  return "npm";
}

function usesYarnPlugAndPlay(repoRoot: string): boolean {
  return (
    existsSync(join(repoRoot, ".pnp.cjs")) ||
    existsSync(join(repoRoot, ".pnp.js"))
  );
}

function runCommand(command: string, args: string[], cwd: string): void {
  const options = {
    cwd,
    stdio: "inherit" as const,
    shell: process.platform === "win32",
  };

  let result = spawnSync(command, args, options);
  if (
    (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" &&
    command !== "npm"
  ) {
    result = spawnSync("corepack", [command, ...args], options);
  }

  if (result.status !== 0) {
    throw new Error(`Failed to run ${command} ${args.join(" ")}`);
  }
}

function getInstallCommand(
  packageManager: PackageManager,
  workspaceRoot: boolean,
  packageSpec: string,
): { command: string; args: string[] } {
  switch (packageManager) {
    case "pnpm":
      return {
        command: "pnpm",
        args: ["add", ...(workspaceRoot ? ["-w"] : []), packageSpec],
      };
    case "yarn":
      return {
        command: "yarn",
        args: ["add", ...(workspaceRoot ? ["-W"] : []), packageSpec],
      };
    case "bun":
      return {
        command: "bun",
        args: ["add", packageSpec],
      };
    case "npm":
      return {
        command: "npm",
        args: ["install", packageSpec],
      };
  }
}

function findInstalledLibrettoPackageRoot(repoRoot: string): string | null {
  const requireFromRepoRoot = createRequire(join(repoRoot, "__create-libretto__.cjs"));

  let librettoEntryPath: string;
  try {
    librettoEntryPath = requireFromRepoRoot.resolve("libretto");
  } catch {
    return null;
  }

  let dir = dirname(librettoEntryPath);
  while (dir !== dirname(dir)) {
    const packageJsonPath = join(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = readJson<{ name?: string }>(packageJsonPath);
      if (packageJson.name === "libretto") {
        return dir;
      }
    }
    dir = dirname(dir);
  }

  throw new Error(
    `Resolved libretto at ${librettoEntryPath}, but could not find libretto/package.json.`,
  );
}

function readInstalledLibrettoInfo(
  repoRoot: string,
): InstalledLibrettoInfo | null {
  const packageRoot = findInstalledLibrettoPackageRoot(repoRoot);
  if (!packageRoot) {
    return null;
  }

  return {
    packageRoot,
    version: readJson<{ version: string }>(join(packageRoot, "package.json")).version,
  };
}

function findDeclaredLibrettoSpec(manifest: ProjectManifest): string | null {
  return (
    manifest.dependencies?.libretto ??
    manifest.devDependencies?.libretto ??
    manifest.optionalDependencies?.libretto ??
    manifest.peerDependencies?.libretto ??
    null
  );
}

function getLibrettoRequire(packageRoot: string): NodeRequire {
  return createRequire(join(packageRoot, "__create-libretto__.cjs"));
}

function readSkillVersion(skillDir: string): string | null {
  const skillPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return null;

  const content = readFileSync(skillPath, "utf8");
  const match = content.match(/^\s*version:\s*"([^"\n]+)"/m);
  return match?.[1] ?? null;
}

function countFiles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(fullPath);
      continue;
    }
    if (entry.isFile()) count += 1;
  }
  return count;
}

function ensureLibrettoWorkspaceState(repoRoot: string): void {
  const librettoDir = join(repoRoot, ".libretto");
  const sessionsDir = join(librettoDir, "sessions");
  const profilesDir = join(librettoDir, "profiles");
  const gitignorePath = join(librettoDir, ".gitignore");

  mkdirSync(librettoDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(profilesDir, { recursive: true });

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, LIBRETTO_GITIGNORE_CONTENT, "utf8");
  }
}

function copySkills(repoRoot: string, librettoPackageRoot: string): void {
  const agentDirs = [join(repoRoot, ".agents"), join(repoRoot, ".claude")].filter(
    (dir) => existsSync(dir),
  );

  if (agentDirs.length === 0) {
    console.log(
      "\nSkills: No .agents/ or .claude/ directory found in repo root — skipping.",
    );
    return;
  }

  const sourceDir = join(librettoPackageRoot, "skills", "libretto");
  const sourceSkillVersion =
    readSkillVersion(sourceDir) ??
    readJson<{ version?: string }>(join(librettoPackageRoot, "package.json")).version ??
    null;

  for (const agentDir of agentDirs) {
    const skillDest = join(agentDir, "skills", "libretto");
    const previousVersion = readSkillVersion(skillDest);
    const name = basename(agentDir);

    rmSync(skillDest, { recursive: true, force: true });
    cpSync(sourceDir, skillDest, { recursive: true });

    let action = "Installed libretto skill";
    if (!previousVersion && sourceSkillVersion) {
      action = `Installed libretto skill v${sourceSkillVersion}`;
    } else if (previousVersion && !sourceSkillVersion) {
      action = `Refreshed libretto skill (previously v${previousVersion})`;
    } else if (previousVersion && sourceSkillVersion) {
      action =
        previousVersion === sourceSkillVersion
          ? `Refreshed libretto skill v${sourceSkillVersion}`
          : `Updated libretto skill ${previousVersion} -> ${sourceSkillVersion}`;
    }

    console.log(
      `  ✓ ${action} to ${name}/skills/libretto/ (${countFiles(skillDest)} files)`,
    );
  }
}

function installBrowsers(librettoPackageRoot: string): void {
  console.log("\nInstalling Playwright Chromium...");
  const librettoRequire = getLibrettoRequire(librettoPackageRoot);
  const playwrightPackageJsonPath = librettoRequire.resolve("playwright/package.json");
  const playwrightPackageJson = readJson<{
    bin?: { playwright?: string };
  }>(playwrightPackageJsonPath);
  const cliRelativePath = playwrightPackageJson.bin?.playwright;

  if (!cliRelativePath) {
    throw new Error(
      "Failed to locate the Playwright CLI in the installed libretto package.",
    );
  }

  const result = spawnSync(
    process.execPath,
    [join(dirname(playwrightPackageJsonPath), cliRelativePath), "install", "chromium"],
    { stdio: "inherit" },
  );

  if (result.status === 0) {
    console.log("  ✓ Playwright Chromium installed");
    return;
  }

  throw new Error(
    "Failed to install Playwright Chromium. Run manually: npx playwright install chromium",
  );
}

async function runLibrettoSetup(options: {
  repoRoot: string;
  librettoPackageRoot: string;
  skipBrowsers: boolean;
}): Promise<void> {
  console.log("Initializing libretto...\n");

  ensureLibrettoWorkspaceState(options.repoRoot);

  if (!options.skipBrowsers) {
    installBrowsers(options.librettoPackageRoot);
  } else {
    console.log("\nSkipping browser installation (--skip-browsers)");
  }

  copySkills(options.repoRoot, options.librettoPackageRoot);

  if (process.stdin.isTTY) {
    await runInteractiveApiSetup(options.repoRoot);
  } else {
    loadSnapshotEnv(options.repoRoot);
    printSnapshotApiStatus(options.repoRoot);
  }

  console.log("\n✓ libretto setup complete");
}

export async function runBootstrap(args: ParsedArgs): Promise<void> {
  const repoRoot = resolveRepoRoot();
  const manifest = readManifest(repoRoot);
  const createVersion = getCreateLibrettoVersion();
  const packageSpec =
    process.env.LIBRETTO_CREATE_LIBRETTO_SPEC?.trim() ||
    `libretto@${createVersion}`;

  process.chdir(repoRoot);
  process.env.LIBRETTO_REPO_ROOT = repoRoot;

  const installedInfo = readInstalledLibrettoInfo(repoRoot);
  const declaredLibrettoSpec = findDeclaredLibrettoSpec(manifest);
  const needsInstall =
    !installedInfo ||
    !declaredLibrettoSpec ||
    (process.env.LIBRETTO_CREATE_LIBRETTO_SPEC
      ? declaredLibrettoSpec !== packageSpec
      : installedInfo.version !== createVersion);

  if (needsInstall) {
    const packageManager = detectPackageManager(repoRoot, manifest);
    if (packageManager === "yarn" && usesYarnPlugAndPlay(repoRoot)) {
      throw new Error(
        "create-libretto does not support Yarn Plug'n'Play yet. Install `libretto` with Yarn first, then rerun setup from your Yarn environment.",
      );
    }

    const installCommand = getInstallCommand(
      packageManager,
      isWorkspaceRoot(repoRoot, manifest),
      packageSpec,
    );
    console.log(`Installing ${packageSpec} with ${packageManager}...`);
    runCommand(installCommand.command, installCommand.args, repoRoot);
  } else {
    console.log(`Using installed libretto@${installedInfo.version}.`);
  }

  const resolvedInstalledInfo = readInstalledLibrettoInfo(repoRoot);
  if (!resolvedInstalledInfo?.packageRoot) {
    throw new Error(
      "libretto is not installed after bootstrap. Try `npm install libretto` and then rerun `npm init libretto@latest`.",
    );
  }

  console.log(
    `Running Libretto setup with libretto@${resolvedInstalledInfo.version}...`,
  );
  await runLibrettoSetup({
    repoRoot,
    librettoPackageRoot: resolvedInstalledInfo.packageRoot,
    skipBrowsers: args.skipBrowsers,
  });
}
