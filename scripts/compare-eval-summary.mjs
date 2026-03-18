#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function usage() {
  console.error(
    "Usage: node scripts/compare-eval-summary.mjs <baseline-summary.json> <current-summary.json> [threshold-percent]",
  );
}

const [, , baselineArg, currentArg, thresholdArg] = process.argv;

if (!baselineArg || !currentArg) {
  usage();
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(resolve(baselineArg), "utf8"));
const current = JSON.parse(readFileSync(resolve(currentArg), "utf8"));
const threshold = thresholdArg ? Number(thresholdArg) : 5;

if (!Number.isFinite(threshold) || threshold < 0) {
  console.error(`Invalid threshold percent: ${thresholdArg}`);
  process.exit(1);
}

const delta = Number((current.percent - baseline.percent).toFixed(2));
const withinThreshold = Math.abs(delta) <= threshold;

const lines = [
  "# Eval Baseline Comparison",
  "",
  `- Baseline score: \`${baseline.percent}%\``,
  `- Current score: \`${current.percent}%\``,
  `- Delta: \`${delta > 0 ? "+" : ""}${delta}%\``,
  `- Allowed range: \`+/-${threshold}%\``,
];

process.stdout.write(`${lines.join("\n")}\n`);

if (!withinThreshold) {
  console.error(
    `Eval score delta ${delta > 0 ? "+" : ""}${delta}% is outside the allowed +/-${threshold}% range.`,
  );
  process.exit(1);
}
