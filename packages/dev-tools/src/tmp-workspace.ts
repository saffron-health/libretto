/**
 * Utility for creating temporary workspaces that test the local libretto package.
 *
 * Shared by the CLI entrypoint, evals, and benchmarks.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type CreateTmpWorkspaceOptions = {
  /** Name for the workspace directory. */
  name: string;
  /** Parent directory (default: <repoRoot>/tmp). */
  parentDir?: string;
  /** Snapshot model (default: vertex/gemini-2.5-flash). */
  snapshotModel?: string;
  /** Skip Playwright browser installation (default: false). */
  skipBrowsers?: boolean;
  /** Additional npm packages to install. */
  extraPackages?: string[];
  /** Suppress stdout from sub-commands (default: false). */
  quiet?: boolean;
  /** Skip building libretto before installing (default: false).
   *  Use when the caller knows libretto is already built, e.g. in
   *  parallel eval/benchmark runs where a prior step handles the build. */
  skipBuild?: boolean;
};

function findRepoRoot(): string {
  const override = process.env.LIBRETTO_REPO_ROOT?.trim();
  if (override) {
    return resolve(override);
  }

  try {
    const result = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.trim();
  } catch {
    return resolve(import.meta.dirname, "..", "..", "..");
  }
}

function run(
  cwd: string,
  command: string,
  args: string[],
  quiet: boolean,
): void {
  execFileSync(command, args, {
    cwd,
    env: process.env,
    stdio: quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "pipe"],
    encoding: "utf8",
  });
}

function resolveProviderPackage(model: string): string | null {
  const provider = model.split("/", 1)[0]?.toLowerCase();
  switch (provider) {
    case "anthropic":
      return "@ai-sdk/anthropic";
    case "google":
    case "gemini":
      return "@ai-sdk/google";
    case "vertex":
      return "@ai-sdk/google-vertex";
    case "openai":
    case "codex":
      return "@ai-sdk/openai";
    default:
      return null;
  }
}

function resolveProviderInstallSpec(
  model: string,
  librettoPackageRoot: string,
): string | null {
  const packageName = resolveProviderPackage(model);
  if (!packageName) return null;

  const manifestPath = join(librettoPackageRoot, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const version = manifest.peerDependencies?.[packageName];
  return version ? `${packageName}@${version}` : packageName;
}

export async function createTmpWorkspace(
  options: CreateTmpWorkspaceOptions,
): Promise<string> {
  const repoRoot = findRepoRoot();
  const librettoPackageRoot = resolve(repoRoot, "packages", "libretto");
  const snapshotModel = options.snapshotModel ?? "vertex/gemini-2.5-flash";
  const quiet = options.quiet ?? false;
  const parentDir = options.parentDir
    ? resolve(options.parentDir)
    : resolve(repoRoot, "tmp");
  const workspaceDir = resolve(parentDir, options.name);

  if (existsSync(workspaceDir)) {
    throw new Error(`Workspace already exists: ${workspaceDir}`);
  }

  mkdirSync(workspaceDir, { recursive: true });

  const log = quiet ? () => {} : (msg: string) => console.log(msg);

  log(`Creating workspace: ${workspaceDir}`);

  // Build libretto so the workspace gets the latest CLI
  if (!options.skipBuild) {
    log("  Building libretto...");
    run(librettoPackageRoot, "pnpm", ["build"], quiet);
  }

  // git init
  log("  Initializing git repo...");
  run(workspaceDir, "git", ["init", "-q"], quiet);

  // .gitignore
  writeFileSync(
    join(workspaceDir, ".gitignore"),
    [
      "node_modules/",
      ".env",
      ".libretto/sessions/",
      ".libretto/profiles/",
      "",
    ].join("\n"),
    "utf-8",
  );

  // package.json
  log("  Writing package.json...");
  writeFileSync(
    join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        name: `libretto-workspace-${options.name}`,
        private: true,
        type: "module",
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );

  // Install local libretto + provider package
  const providerSpec = resolveProviderInstallSpec(
    snapshotModel,
    librettoPackageRoot,
  );
  const installArgs = [
    "add",
    "--lockfile=false",
    `file:${librettoPackageRoot}`,
    ...(providerSpec ? [providerSpec] : []),
    ...(options.extraPackages ?? []),
  ];
  log(`  Installing packages: pnpm ${installArgs.join(" ")}`);
  run(workspaceDir, "pnpm", installArgs, quiet);

  // Create .agents/ and .claude/ so `libretto setup` copies skills into them
  mkdirSync(join(workspaceDir, ".agents"), { recursive: true });
  mkdirSync(join(workspaceDir, ".claude"), { recursive: true });

  // Run libretto setup (creates .libretto/ dirs, .gitignore, copies skills, installs browsers)
  const setupArgs = ["libretto", "setup"];
  if (options.skipBrowsers) {
    setupArgs.push("--skip-browsers");
  }
  log(`  Running npx ${setupArgs.join(" ")}...`);
  run(workspaceDir, "npx", setupArgs, quiet);

  // Configure snapshot model
  log(`  Configuring snapshot model: ${snapshotModel}`);
  run(
    workspaceDir,
    "npx",
    ["libretto", "ai", "configure", snapshotModel],
    quiet,
  );

  // Write .env with GCP project if available
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim();
  if (projectId) {
    log(`  Writing .env with GOOGLE_CLOUD_PROJECT=${projectId}`);
    writeFileSync(
      join(workspaceDir, ".env"),
      [
        "# Workspace runtime configuration",
        `GOOGLE_CLOUD_PROJECT=${projectId}`,
        `GCLOUD_PROJECT=${projectId}`,
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  return workspaceDir;
}
