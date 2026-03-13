import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const BENCHMARK_PATHS: Record<string, string> = {
  onlineMind2Web: "benchmarks/onlineMind2Web",
  onlinemind2web: "benchmarks/onlineMind2Web",
  webVoyager: "benchmarks/webVoyager",
  webvoyager: "benchmarks/webVoyager",
  webBench: "benchmarks/webBench",
  webbench: "benchmarks/webBench",
};

function printUsage(): void {
  console.log(
    [
      "Usage: pnpm benchmark [onlineMind2Web|webVoyager|webBench] [vitest args...]",
      "",
      "Examples:",
      "  pnpm benchmark",
      "  pnpm benchmark onlineMind2Web",
      "  pnpm benchmark -- --testNamePattern FINAL_RESULT",
    ].join("\n"),
  );
}

const requestedArgs = process.argv.slice(2);

if (requestedArgs.includes("help") || requestedArgs.includes("--help") || requestedArgs.includes("-h")) {
  printUsage();
  process.exit(0);
}

const benchmarkFilters: string[] = [];
const passthroughArgs: string[] = [];

for (const arg of requestedArgs) {
  if (arg === "--") {
    continue;
  }
  const mappedPath = BENCHMARK_PATHS[arg];
  if (mappedPath) {
    benchmarkFilters.push(mappedPath);
    continue;
  }
  passthroughArgs.push(arg);
}

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.benchmarks.config.ts",
    ...passthroughArgs,
    ...benchmarkFilters,
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
