/**
 * Utility for creating temporary workspaces that test the local libretto package.
 *
 * Shared by the CLI entrypoint, evals, and benchmarks.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type CreateTmpWorkspaceOptions = {
  /** Name for the workspace directory. */
  name: string;
  /** Parent directory (default: <repoRoot>/tmp). */
  parentDir?: string;
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

type PackageManifest = Record<string, unknown> & {
  name: string;
  version: string;
};

let packedPackageTarballsPromise: Promise<string[]> | null = null;

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

function parseManifest(raw: string, source: string): PackageManifest {
  const parsed = JSON.parse(raw) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { name?: unknown }).name !== "string" ||
    typeof (parsed as { version?: unknown }).version !== "string"
  ) {
    throw new Error(`Invalid package manifest: ${source}`);
  }
  return parsed as PackageManifest;
}

function packageTarballName(manifest: PackageManifest): string {
  return `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
}

function packPackage(
  packagePath: string,
  destination: string,
  quiet: boolean,
): string {
  const sourceManifest = parseManifest(
    readFileSync(join(packagePath, "package.json"), "utf8"),
    join(packagePath, "package.json"),
  );

  run(packagePath, "pnpm", ["pack", "--pack-destination", destination], quiet);

  return join(destination, packageTarballName(sourceManifest));
}

async function getPackedPackageTarballs(
  repoRoot: string,
  quiet: boolean,
): Promise<string[]> {
  packedPackageTarballsPromise ??= Promise.resolve().then(() => {
    const packDir = resolve(
      tmpdir(),
      `libretto-packed-packages-${process.pid}-${Date.now()}`,
    );
    mkdirSync(packDir, { recursive: true });

    return [
      packPackage(resolve(repoRoot, "packages", "affordance"), packDir, quiet),
      packPackage(resolve(repoRoot, "packages", "libretto"), packDir, quiet),
    ];
  });
  return packedPackageTarballsPromise;
}

export async function createTmpWorkspace(
  options: CreateTmpWorkspaceOptions,
): Promise<string> {
  const repoRoot = findRepoRoot();
  const librettoPackageRoot = resolve(repoRoot, "packages", "libretto");
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

  // Install local libretto plus any caller-requested packages.
  const packageTarballs = await getPackedPackageTarballs(repoRoot, quiet);

  const installArgs = [
    "add",
    "--lockfile=false",
    "--ignore-scripts",
    ...packageTarballs,
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
