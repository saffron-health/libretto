#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { SKILL_DIRS, syncSkillDir } from "./skills-libretto.mjs";

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

const sourceDir = join(packageRoot, "skills", "libretto");
if (!existsSync(sourceDir)) process.exit(0);

const syncMissingDirs = repoRoot === packageRoot;
for (const dir of SKILL_DIRS.slice(1)) {
  const rootName = dir.split("/")[0];
  const rootDir = join(repoRoot, rootName);
  if (!syncMissingDirs && !existsSync(rootDir)) continue;
  const dest = join(repoRoot, dir);
  syncSkillDir(sourceDir, dest);
  console.log(`libretto: synced skills/libretto -> ${dest}`);
}
