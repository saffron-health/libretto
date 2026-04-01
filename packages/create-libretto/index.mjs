#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));
const version = pkg.version;

console.log(`Setting up Libretto v${version}...\n`);

// Install the version-locked libretto package
try {
  console.log(`Installing libretto@${version}...`);
  execSync(`npm install libretto@${version}`, { stdio: "inherit" });
} catch (error) {
  console.error(`\nFailed to install libretto@${version}.`);
  process.exit(1);
}

// Run libretto setup
try {
  console.log(`\nRunning libretto setup...\n`);
  execSync(`npx libretto setup`, { stdio: "inherit" });
} catch (error) {
  console.error(`\nFailed to run libretto setup.`);
  process.exit(1);
}
