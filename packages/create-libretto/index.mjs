#!/usr/bin/env node

import { execSync, spawn } from "node:child_process";
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
// ANSI helpers
// ---------------------------------------------------------------------------

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CLEAR_LINE = "\x1b[2K";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";

// ---------------------------------------------------------------------------
// Package manager detection
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
// Interactive prompt
// ---------------------------------------------------------------------------

/**
 * Interactive prompt with a dim placeholder that disappears while typing
 * and reappears when the input is empty, like create-next-app.
 * Shows ✔ in green on completion.
 */
function promptProjectName(defaultName) {
  return new Promise((resolve) => {
    const label = `${BOLD}What is your project named?${RESET}`;
    const pendingPrompt = `${CYAN}?${RESET} ${label} `;
    const donePrompt = `${GREEN}✔${RESET} ${label} `;
    let value = "";

    function render() {
      const display = value || `${DIM}${defaultName}${RESET}`;
      process.stdout.write(`\r${CLEAR_LINE}${pendingPrompt}${display}`);
      // Place cursor right after the typed text (not after the placeholder)
      if (!value) {
        const placeholderLen = defaultName.length;
        process.stdout.write(`\x1b[${placeholderLen}D`);
      }
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    render();

    process.stdin.on("data", (key) => {
      // Ctrl+C
      if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write(`\n${RED}Cancelled${RESET}\n`);
        process.exit(130);
      }
      // Enter
      if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeAllListeners("data");
        const resolved = value || defaultName;
        process.stdout.write(`\r${CLEAR_LINE}${donePrompt}${resolved}\n`);
        resolve(resolved);
        return;
      }
      // Backspace / Delete
      if (key === "\x7f" || key === "\b") {
        value = value.slice(0, -1);
        render();
        return;
      }
      // Ignore other control characters
      if (key.charCodeAt(0) < 32) return;
      value += key;
      render();
    });
  });
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function createSpinner(message) {
  let i = 0;
  const interval = setInterval(() => {
    const frame = SPINNER_FRAMES[i++ % SPINNER_FRAMES.length];
    process.stdout.write(`\r${CLEAR_LINE}${frame} ${message}`);
  }, 80);
  return {
    stop(finalMessage) {
      clearInterval(interval);
      process.stdout.write(`\r${CLEAR_LINE}${finalMessage ?? ""}\n`);
    },
  };
}

/**
 * Run install command asynchronously so the spinner can animate.
 * Returns { stdout, stderr, status }.
 */
function runInstallAsync(cmd, cwd) {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd.split(" ");
    const child = spawn(bin, args, {
      cwd,
      stdio: ["inherit", "pipe", "pipe"],
      shell: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("close", (status, signal) => {
      resolve({ stdout, stderr, status, signal });
    });
  });
}

// ---------------------------------------------------------------------------
// Scaffold
// ---------------------------------------------------------------------------

/**
 * Read dependencies and devDependencies from the generated package.json.
 */
function readDepsFromPackageJson(targetDir) {
  const pkg = JSON.parse(
    readFileSync(join(targetDir, "package.json"), "utf-8"),
  );
  return {
    dependencies: Object.keys(pkg.dependencies ?? {}),
    devDependencies: Object.keys(pkg.devDependencies ?? {}),
  };
}

/**
 * Scaffold a new Libretto project into `targetDir`.
 *
 * Exported so tests can call it directly with `skipInstall: true`.
 */
export async function scaffoldProject(
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
  //    Set LIBRETTO_DEV=1 to use a file: dependency pointing at the local build.
  const localLibrettoDir = resolve(__dirname, "..", "libretto");
  let librettoVersion;
  if (process.env.LIBRETTO_DEV === "1") {
    librettoVersion = `file:${localLibrettoDir}`;
  } else {
    const ownPkg = JSON.parse(
      readFileSync(join(__dirname, "package.json"), "utf-8"),
    );
    librettoVersion = `^${ownPkg.version}`;
  }

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
    const { dependencies, devDependencies } =
      readDepsFromPackageJson(targetDir);

    if (dependencies.length > 0) {
      console.log(`Installing dependencies:`);
      for (const dep of dependencies) {
        console.log(`- ${dep}`);
      }
      if (devDependencies.length > 0) console.log();
    }

    if (devDependencies.length > 0) {
      console.log(`Installing devDependencies:`);
      for (const dep of devDependencies) {
        console.log(`- ${dep}`);
      }
    }
    console.log();

    const spinner = createSpinner("Installing packages...");
    const result = await runInstallAsync(installCommand(pkgManager), targetDir);
    spinner.stop();

    // Print stderr (warnings)
    if (result.stderr) {
      for (const line of result.stderr.split("\n")) {
        if (line.trim()) console.error(line);
      }
    }

    if (result.status !== 0) {
      console.error(`\nFailed to install dependencies.`);
      process.exit(1);
    }

    // Print stdout summary lines (e.g. "added 123 packages...")
    if (result.stdout) {
      for (const line of result.stdout.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) console.log(trimmed);
      }
    }

    console.log();

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

async function main() {
  process.on("SIGINT", () => {
    console.log(`\n${RED}Cancelled${RESET}`);
    process.exit(130);
  });

  if (process.env.LIBRETTO_DEV === "1") {
    const localLibrettoDir = resolve(__dirname, "..", "libretto");
    console.log(`${DIM}Dev mode: using local libretto from ${localLibrettoDir}${RESET}\n`);
  }

  const DEFAULT_NAME = "my-automations";
  let rawName = process.argv[2];

  if (!rawName) {
    if (process.stdin.isTTY) {
      rawName = await promptProjectName(DEFAULT_NAME);
    } else {
      rawName = DEFAULT_NAME;
    }
  }

  const targetDir = resolve(rawName);
  const projectName = basename(targetDir);
  const pkgManager = detectPackageManager();

  // Bail if directory exists and is non-empty
  if (existsSync(targetDir)) {
    const entries = readdirSync(targetDir);
    if (entries.length > 0) {
      console.error(
        `Error: Target directory "${targetDir}" already exists and is not empty.`,
      );
      process.exit(1);
    }
  }

  console.log(
    `\nCreating a new Libretto project in ${BOLD}${targetDir}${RESET}.\n`,
  );
  console.log(`Using ${BOLD}${pkgManager}${RESET} and TypeScript.\n`);

  await scaffoldProject(targetDir, projectName, pkgManager);

  console.log(
    `\n${GREEN}Success!${RESET} Created ${BOLD}${projectName}${RESET} at ${targetDir}\n`,
  );
}

// Only run main when this file is executed directly (not imported)
if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
