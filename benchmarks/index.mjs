#!/usr/bin/env node

import { runOnlineMind2WebBenchmark } from "./onlineMind2Web/index.mjs";

const scriptArgs = process.argv.slice(2);
const normalizedArgs =
  scriptArgs.length > 0 && scriptArgs[0] === "--" ? scriptArgs.slice(1) : scriptArgs;

const [benchmarkName, ...restArgs] = normalizedArgs;

function printUsage() {
  console.log(`Usage: pnpm benchmark <benchmark> [options]

Benchmarks:
  onlineMind2Web

Examples:
  pnpm benchmark onlineMind2Web --agent claude --limit 5
  pnpm benchmark onlineMind2Web --agent codex --model gpt-5-codex --limit 5
`);
}

if (!benchmarkName || benchmarkName === "--help" || benchmarkName === "-h") {
  printUsage();
  process.exit(0);
}

const normalized = benchmarkName.trim().toLowerCase();

if (normalized === "onlinemind2web") {
  await runOnlineMind2WebBenchmark(restArgs);
  process.exit(0);
}

console.error(`Unknown benchmark: ${benchmarkName}`);
printUsage();
process.exit(1);
