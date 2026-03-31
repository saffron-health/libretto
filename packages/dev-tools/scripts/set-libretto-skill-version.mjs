#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { setLibrettoSkillVersion } from "./mirrors-libretto.mjs";

const nextVersion = process.argv[2]?.trim();
if (!nextVersion) {
  console.error("Usage: node packages/dev-tools/scripts/set-libretto-skill-version.mjs <version>");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");

setLibrettoSkillVersion(repoRoot, nextVersion);
