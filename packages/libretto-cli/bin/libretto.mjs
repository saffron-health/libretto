#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");
const distEntry = join(cliRoot, "dist", "index.js");

if (!existsSync(distEntry)) {
  // Build from the libretto monorepo root (builds core then CLI in order)
  const monorepoRoot = join(cliRoot, "..", "..");
  console.error("[libretto] dist not found, building...");
  execSync("pnpm build", { cwd: monorepoRoot, stdio: "inherit" });
}

await import(distEntry);
