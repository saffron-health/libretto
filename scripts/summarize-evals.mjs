#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function usage() {
  console.error(
    "Usage: node scripts/summarize-evals.mjs <score-dir> <summary-json-path>",
  );
}

function normalizeFailureRecord(failure) {
  return {
    criterion: String(failure?.criterion ?? "").trim(),
    reason: String(failure?.reason ?? "").trim(),
  };
}

function normalizeRecord(record) {
  const failures = Array.isArray(record?.failures)
    ? record.failures
        .map(normalizeFailureRecord)
        .filter(
          (failure) =>
            failure.criterion.length > 0 && failure.reason.length > 0,
        )
    : [];

  return {
    name: String(record?.name ?? "").trim(),
    passed: Number(record?.passed ?? 0),
    total: Number(record?.total ?? 0),
    percent: Number(record?.percent ?? 0),
    failures,
  };
}

export function loadScoreRecords(scoreDirArg) {
  const scoreDir = resolve(scoreDirArg);
  return readdirSync(scoreDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) =>
      JSON.parse(readFileSync(join(scoreDir, entry.name), "utf8")),
    )
    .map(normalizeRecord)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function buildSummary(records) {
  const passed = records.reduce(
    (sum, record) => sum + Number(record.passed || 0),
    0,
  );
  const total = records.reduce(
    (sum, record) => sum + Number(record.total || 0),
    0,
  );
  const percent = total > 0 ? Number(((passed / total) * 100).toFixed(2)) : 0;
  const failingRecords = records.filter((record) => record.failures.length > 0);

  return {
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    passed,
    total,
    percent,
    failingRecordCount: failingRecords.length,
    records,
  };
}

export function buildMarkdown(summary, summaryPathArg) {
  const lines = [
    "# Eval Summary",
    "",
    `- Overall score: \`${summary.percent}%\``,
    `- Passed criteria: \`${summary.passed}/${summary.total}\``,
    `- Recorded score entries: \`${summary.recordCount}\``,
    `- Failed evals: \`${summary.failingRecordCount}\``,
    `- Summary file: \`${basename(summaryPathArg)}\``,
  ];

  if (summary.records.length > 0) {
    lines.push("", "## Breakdown", "");
    for (const record of summary.records) {
      const status = record.failures.length > 0 ? "fail" : "pass";
      lines.push(
        `- ${status} \`${record.name}\`: \`${record.percent}%\` (${record.passed}/${record.total})`,
      );
    }
  }

  if (summary.failingRecordCount > 0) {
    lines.push("", "## Failed Evals", "");
    for (const record of summary.records.filter(
      (candidate) => candidate.failures.length > 0,
    )) {
      lines.push(`### \`${record.name}\``);
      lines.push("");
      lines.push(
        `- Score: \`${record.percent}%\` (${record.passed}/${record.total})`,
      );
      for (const failure of record.failures) {
        lines.push(`- ${failure.criterion}: ${failure.reason}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function main(argv) {
  const [, , scoreDirArg, summaryPathArg] = argv;

  if (!scoreDirArg || !summaryPathArg) {
    usage();
    process.exit(1);
  }

  const summaryPath = resolve(summaryPathArg);
  const records = loadScoreRecords(scoreDirArg);
  const summary = buildSummary(records);

  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(buildMarkdown(summary, summaryPath));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv);
}
