#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const command = args[0] ?? "run";
const needsBuild = command !== "summary" && command !== "profiles";

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    ...options,
  });
}

if (needsBuild) {
  const build = spawnSync(
    "pnpm",
    [
      "-s",
      "turbo",
      "run",
      "build",
      "--filter=@libretto/evals^...",
      "--output-logs=errors-only",
      "--log-prefix=none",
    ],
    {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (build.status !== 0 || build.error) {
    process.stderr.write(build.stdout ?? "");
    process.stderr.write(build.stderr ?? "");
    if (build.error) {
      process.stderr.write(`${build.error.message}\n`);
    }
    process.exit(build.status ?? 1);
  }
}

const evals = run("pnpm", ["--dir", "evals", "-s", "evals", ...args]);
if (evals.error) {
  process.stderr.write(`${evals.error.message}\n`);
  process.exit(1);
}
process.exit(evals.status ?? 1);
