#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

function usage() {
  console.error("Usage: node scripts/summarize-evals.mjs <score-dir> <summary-json-path>");
}

const [, , scoreDirArg, summaryPathArg] = process.argv;

if (!scoreDirArg || !summaryPathArg) {
  usage();
  process.exit(1);
}

const scoreDir = resolve(scoreDirArg);
const summaryPath = resolve(summaryPathArg);

const records = readdirSync(scoreDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => JSON.parse(readFileSync(join(scoreDir, entry.name), "utf8")))
  .sort((a, b) => String(a.name).localeCompare(String(b.name)));

const passed = records.reduce((sum, record) => sum + Number(record.passed || 0), 0);
const total = records.reduce((sum, record) => sum + Number(record.total || 0), 0);
const percent = total > 0 ? Number(((passed / total) * 100).toFixed(2)) : 0;

const summary = {
  generatedAt: new Date().toISOString(),
  recordCount: records.length,
  passed,
  total,
  percent,
  records,
};

writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const lines = [
  "# Eval Summary",
  "",
  `- Overall score: \`${summary.percent}%\``,
  `- Passed criteria: \`${summary.passed}/${summary.total}\``,
  `- Recorded score entries: \`${summary.recordCount}\``,
  `- Summary file: \`${basename(summaryPath)}\``,
];

if (records.length > 0) {
  lines.push("", "## Breakdown", "");
  for (const record of records) {
    lines.push(`- \`${record.name}\`: \`${record.percent}%\` (${record.passed}/${record.total})`);
  }
}

process.stdout.write(`${lines.join("\n")}\n`);
