#!/usr/bin/env node

import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect the package manager that invoked `create-libretto` by inspecting the
 * `npm_config_user_agent` env var (Vite-style detection).
 */
export function detectPackageManager() {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("bun")) return "bun";
  return "npm";
}

/** Return the exec command for running a local bin with the given package manager. */
function execCommand(pkgManager) {
  switch (pkgManager) {
    case "pnpm":
      return "pnpm exec";
    case "yarn":
      return "yarn";
    case "bun":
      return "bunx";
    default:
      return "npx";
  }
}

/** Return the install command for the given package manager. */
function installCommand(pkgManager) {
  switch (pkgManager) {
    case "yarn":
      return "yarn";
    case "bun":
      return "bun install";
    default:
      return `${pkgManager} install`;
  }
}

/** Return the run command for scripts (used in next-steps messaging). */
function runCommand(pkgManager) {
  switch (pkgManager) {
    case "npm":
      return "npx";
    case "pnpm":
      return "pnpm exec";
    case "yarn":
      return "yarn";
    case "bun":
      return "bunx";
    default:
      return "npx";
  }
}

// ---------------------------------------------------------------------------
// Scaffold
// ---------------------------------------------------------------------------

/**
 * Scaffold a new Libretto project into `targetDir`.
 *
 * Exported so tests can call it directly with `skipInstall: true`.
 */
export function scaffoldProject(
  targetDir,
  projectName,
  pkgManager,
  { skipInstall = false } = {},
) {
  const templateDir = join(__dirname, "template");

  // 1. Copy template/ → targetDir (recursive)
  mkdirSync(targetDir, { recursive: true });
  cpSync(templateDir, targetDir, { recursive: true });

  // 2. Rename _gitignore → .gitignore
  const gitignoreSrc = join(targetDir, "_gitignore");
  if (existsSync(gitignoreSrc)) {
    renameSync(gitignoreSrc, join(targetDir, ".gitignore"));
  }

  // 3. Process package.json.template → package.json
  const ownPkg = JSON.parse(
    readFileSync(join(__dirname, "package.json"), "utf-8"),
  );
  const librettoVersion = `^${ownPkg.version}`;

  const pkgTemplatePath = join(targetDir, "package.json.template");
  const pkgContents = readFileSync(pkgTemplatePath, "utf-8")
    .replaceAll("{{projectName}}", projectName)
    .replaceAll("{{librettoVersion}}", librettoVersion);
  writeFileSync(join(targetDir, "package.json"), pkgContents);
  unlinkSync(pkgTemplatePath);

  // 4. Process README.md
  const readmePath = join(targetDir, "README.md");
  const readmeContents = readFileSync(readmePath, "utf-8")
    .replaceAll("{{projectName}}", projectName)
    .replaceAll("{{runCommand}}", runCommand(pkgManager));
  writeFileSync(readmePath, readmeContents);

  // 5. Install dependencies & run setup
  if (!skipInstall) {
    console.log(`Installing dependencies with ${pkgManager}...\n`);
    try {
      execSync(installCommand(pkgManager), {
        cwd: targetDir,
        stdio: "inherit",
      });
    } catch {
      console.error(`\nFailed to install dependencies.`);
      process.exit(1);
    }

    console.log(`Running libretto setup...\n`);
    try {
      execSync(`${execCommand(pkgManager)} libretto setup`, {
        cwd: targetDir,
        stdio: "inherit",
      });
    } catch {
      console.error(`\nFailed to run libretto setup.`);
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const rawName = process.argv[2] ?? "libretto-automations";
  const targetDir = resolve(rawName);
  const projectName = basename(targetDir);
  const relPath = relative(process.cwd(), targetDir) || ".";
  const cdTarget = relPath.startsWith("..") ? targetDir : relPath;
  const pkgManager = detectPackageManager();

  // Bail if directory exists and is non-empty
  if (existsSync(targetDir)) {
    const entries = readdirSync(targetDir);
    if (entries.length > 0) {
      console.error(
        `Error: Target directory "${cdTarget}" already exists and is not empty.`,
      );
      process.exit(1);
    }
  }

  console.log(`\nScaffolding Libretto project in ${cdTarget}...\n`);

  scaffoldProject(targetDir, projectName, pkgManager);

  const run = runCommand(pkgManager);

  console.log(`
Done! Your Libretto project is ready.

Next steps:

  cd ${cdTarget}
  ${run} libretto open https://example.com --headed   # explore a page interactively
  ${run} libretto run src/workflows/star-repo.ts       # run the example workflow
`);
}

// Only run main when this file is executed directly (not imported)
if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)
) {
  main();
}
