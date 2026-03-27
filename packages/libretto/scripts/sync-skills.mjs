#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SKILL_DIRS, syncRepoSkills } from "./skills-libretto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

syncRepoSkills(repoRoot);
console.log(`libretto: synced skill mirrors across ${SKILL_DIRS.join(", ")}`);
