#!/usr/bin/env node
/**
 * Thin Node entrypoint for the repo-local wt script.
 *
 * The authoritative worktree lifecycle implementation lives in `.bin/wt`.
 * Keep this wrapper minimal so package/bin invocations stay aligned with the
 * shell script's runtime behavior.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const WT_SCRIPT_PATH = resolve(import.meta.dirname, "..", "..", "..", ".bin", "wt");

function main(): void {
  if (!existsSync(WT_SCRIPT_PATH)) {
    throw new Error(`Could not find worktree script at ${WT_SCRIPT_PATH}`);
  }

  const result = spawnSync("bash", [WT_SCRIPT_PATH, ...process.argv.slice(2)], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }

  process.exit(result.status ?? 1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
