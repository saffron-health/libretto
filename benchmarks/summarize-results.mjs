import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, join, resolve } from "node:path";

export function walkResults(root) {
  const results = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name === "results.json") {
        results.push(entryPath);
      }
    }
  }

  return results.sort();
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function formatDuration(durationMs) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return "n/a";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatCost(costUsd) {
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd)) {
    return "n/a";
  }
  return `$${costUsd.toFixed(4)}`;
}

export function getRowCostUsd(row) {
  if (typeof row.totalCostUsd === "number" && Number.isFinite(row.totalCostUsd)) {
    return row.totalCostUsd;
  }
  if (typeof row.costUsd === "number" && Number.isFinite(row.costUsd)) {
    return row.costUsd;
  }
  return null;
}

export function readJsonl(path) {
  try {
    const contents = readFileSync(path, "utf8");
    return contents
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function getLatestBenchmarkRunRecord(root, benchmark) {
  const historyPath = resolve(root, "benchmarks", "run-history.jsonl");
  const records = readJsonl(historyPath)
    .filter((record) => {
      if (!Array.isArray(record.benchmarks)) {
        return false;
      }
      if (record.scope !== "selected") {
        return false;
      }
      return record.benchmarks.length === 1 && record.benchmarks[0] === benchmark;
    })
    .sort((a, b) => {
      const aFinished = typeof a.finishedAt === "string" ? Date.parse(a.finishedAt) : 0;
      const bFinished = typeof b.finishedAt === "string" ? Date.parse(b.finishedAt) : 0;
      return bFinished - aFinished;
    });
  return records[0] ?? null;
}

export function filterResultPathsForRunRecord(resultPaths, runRecord) {
  if (
    !runRecord ||
    typeof runRecord.startedAt !== "string" ||
    typeof runRecord.finishedAt !== "string"
  ) {
    return resultPaths;
  }

  const startedAtMs = Date.parse(runRecord.startedAt);
  const finishedAtMs = Date.parse(runRecord.finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    return resultPaths;
  }

  return resultPaths.filter((path) => {
    try {
      const stats = statSync(path);
      return stats.mtimeMs >= startedAtMs && stats.mtimeMs <= finishedAtMs;
    } catch {
      return false;
    }
  });
}

function clip(text, maxChars = 120) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return "n/a";
  }
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars - 1)}…`;
}

function escapeMarkdownTableCell(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function getStatusEmoji(status) {
  switch (status) {
    case "passed":
      return "pass";
    case "failed":
      return "fail";
    default:
      return "running";
  }
}

export function buildMarkdown({
  benchmark,
  runMode,
  sampleSize,
  randomSeed,
  runUrl,
  artifactName,
  rows,
  runRecord,
}) {
  const resultFileCount =
    typeof runRecord?.resultFileCount === "number"
      ? runRecord.resultFileCount
      : rows.length;
  const passed = rows.filter((row) => row.status === "passed").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const running = rows.filter((row) => row.status === "running").length;
  const totalCostUsd = rows.reduce((sum, row) => {
    const rowCostUsd = getRowCostUsd(row);
    return rowCostUsd == null ? sum : sum + rowCostUsd;
  }, 0);
  const costTracked =
    typeof runRecord?.costTrackedResultCount === "number"
      ? runRecord.costTrackedResultCount
      : rows.filter((row) => getRowCostUsd(row) != null).length;
  const runTotalCostUsd =
    typeof runRecord?.totalCostUsd === "number"
      ? runRecord.totalCostUsd
      : costTracked > 0
        ? totalCostUsd
        : null;

  const lines = [
    "# Benchmark Results",
    "",
    `- Benchmark: \`${benchmark}\``,
    `- Mode: \`${runMode}\``,
    `- Sample size: \`${sampleSize}\``,
    `- Seed: \`${randomSeed}\``,
    `- Result files: \`${resultFileCount}\``,
    `- Passed: \`${passed}\``,
    `- Failed: \`${failed}\``,
    `- Incomplete: \`${running}\``,
    `- Cost tracked: \`${costTracked}\``,
    `- Total cost: \`${formatCost(runTotalCostUsd)}\``,
  ];

  if (runUrl) {
    lines.push(`- Workflow run: ${runUrl}`);
  }
  if (artifactName) {
    lines.push(`- Artifact: \`${artifactName}\``);
  }

  lines.push(
    "",
    "| Benchmark Run | Duration | Cost | Result files | Cost tracked |",
    "| --- | --- | --- | --- | --- |",
    `| \`${benchmark}\` | \`${formatDuration(runRecord?.durationMs)}\` | \`${formatCost(runTotalCostUsd)}\` | \`${resultFileCount}\` | \`${costTracked}\` |`,
  );

  lines.push(
    "",
    "| Case | Status | Duration | Cost | Summary |",
    "| --- | --- | --- | --- | --- |",
  );

  if (rows.length === 0) {
    lines.push("| n/a | n/a | n/a | n/a | No results.json files were generated. |");
    return lines.join("\n");
  }

  for (const row of rows) {
    const summarySource =
      row.finalResult ||
      row.error?.message ||
      row.error?.name ||
      "No final result recorded.";
    lines.push(
      `| \`${row.caseId ?? basename(row.runRoot ?? "unknown")}\` | ${getStatusEmoji(row.status)} \`${row.status ?? "unknown"}\` | \`${formatDuration(row.durationMs)}\` | \`${formatCost(getRowCostUsd(row))}\` | ${escapeMarkdownTableCell(clip(summarySource))} |`,
    );
  }

  return lines.join("\n");
}

function main() {
  const benchmark = process.argv[2];
  const outputPath = process.argv[3];

  if (!benchmark || !outputPath) {
    console.error(
      "Usage: node benchmarks/summarize-results.mjs <benchmark> <output-path>",
    );
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const runsRoot = resolve(repoRoot, "benchmarks", benchmark, "runs");
  const runRecord = getLatestBenchmarkRunRecord(repoRoot, benchmark);
  const resultPaths = filterResultPathsForRunRecord(
    walkResults(runsRoot),
    runRecord,
  );
  const rows = resultPaths.map((path) => readJson(path));

  rows.sort((a, b) => {
    const caseA = String(a.caseId ?? "");
    const caseB = String(b.caseId ?? "");
    return caseA.localeCompare(caseB);
  });

  const markdown = buildMarkdown({
    benchmark,
    runMode: process.env.BENCHMARK_RUN_MODE ?? "unknown",
    sampleSize: process.env.BENCHMARK_SAMPLE_SIZE ?? "n/a",
    randomSeed: process.env.BENCHMARK_RANDOM_SEED ?? "n/a",
    runUrl: process.env.BENCHMARK_RUN_URL ?? "",
    artifactName: process.env.BENCHMARK_ARTIFACT_NAME ?? "",
    rows,
    runRecord,
  });

  writeFileSync(outputPath, markdown, "utf8");
  process.stdout.write(markdown);
}

function isExecutedAsScript() {
  return (
    typeof process.argv[1] === "string" &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isExecutedAsScript()) {
  main();
}
