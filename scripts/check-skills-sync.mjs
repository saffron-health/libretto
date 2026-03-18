#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compareSkillDirs, SKILL_DIRS } from "./skills-libretto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const result = compareSkillDirs(repoRoot);

if (result.ok) {
  console.log(`libretto: verified identical skill mirrors across ${SKILL_DIRS.join(", ")}`);
  process.exit(0);
}

console.error("libretto: skill directories must be identical:");
for (const issue of result.issues) {
  console.error(`- ${issue}`);
}
console.error("");
console.error("Run `pnpm i` to resync the mirrors in this repository.");
process.exit(1);
