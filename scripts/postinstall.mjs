#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");

// Install Playwright Chromium
spawnSync("npx", ["playwright", "install", "chromium"], {
  stdio: "inherit",
  shell: true,
});

const installCwd = process.env.INIT_CWD?.trim() || null;
if (!installCwd) {
  console.warn(
    "libretto: automatic skill install failed because INIT_CWD is not set. Run `npx skills add saffron-health/libretto` to add the skills manually.",
  );
  process.exit(0);
}

// Resolve the consuming project's repo root from the original install cwd,
// not pnpm's content-addressable store path.
const gitResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: installCwd,
  encoding: "utf-8",
  stdio: ["pipe", "pipe", "pipe"],
});
const repoRoot = gitResult.status === 0 && gitResult.stdout
  ? gitResult.stdout.trim()
  : installCwd;

// Sync skills to any agent dirs at repo root
const sourceDir = join(packageRoot, "skills", "libretto");
if (!existsSync(sourceDir)) process.exit(0);

const agentDirNames = [".agents", ".claude"];
for (const name of agentDirNames) {
  const agentDir = join(repoRoot, name);
  if (!existsSync(agentDir)) continue;
  const dest = join(agentDir, "skills", "libretto");
  if (existsSync(dest)) rmSync(dest, { recursive: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(sourceDir, dest, { recursive: true });
  const count = readdirSync(dest).length;
  console.log(`libretto: synced ${count} skill files to ${dest}`);
}
