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

// Find git repo root
const gitResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf-8",
  stdio: ["pipe", "pipe", "pipe"],
});
const repoRoot = gitResult.status === 0 && gitResult.stdout
  ? gitResult.stdout.trim()
  : null;
if (!repoRoot) process.exit(0);

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
