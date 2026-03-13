import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

function walkResults(root) {
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function formatDuration(durationMs) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return "n/a";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
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

function buildMarkdown({
  benchmark,
  runMode,
  sampleSize,
  randomSeed,
  runUrl,
  artifactName,
  rows,
}) {
  const passed = rows.filter((row) => row.status === "passed").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const running = rows.filter((row) => row.status === "running").length;

  const lines = [
    "# Benchmark Results",
    "",
    `- Benchmark: \`${benchmark}\``,
    `- Mode: \`${runMode}\``,
    `- Sample size: \`${sampleSize}\``,
    `- Seed: \`${randomSeed}\``,
    `- Result files: \`${rows.length}\``,
    `- Passed: \`${passed}\``,
    `- Failed: \`${failed}\``,
    `- Incomplete: \`${running}\``,
  ];

  if (runUrl) {
    lines.push(`- Workflow run: ${runUrl}`);
  }
  if (artifactName) {
    lines.push(`- Artifact: \`${artifactName}\``);
  }

  lines.push("", "| Case | Status | Duration | Summary |", "| --- | --- | --- | --- |");

  if (rows.length === 0) {
    lines.push("| n/a | n/a | n/a | No results.json files were generated. |");
    return lines.join("\n");
  }

  for (const row of rows) {
    const summarySource =
      row.finalResult ||
      row.error?.message ||
      row.error?.name ||
      "No final result recorded.";
    lines.push(
      `| \`${row.caseId ?? basename(row.runRoot ?? "unknown")}\` | ${getStatusEmoji(row.status)} \`${row.status ?? "unknown"}\` | \`${formatDuration(row.durationMs)}\` | ${escapeMarkdownTableCell(clip(summarySource))} |`,
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
  const resultPaths = walkResults(runsRoot);
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
  });

  writeFileSync(outputPath, markdown, "utf8");
  process.stdout.write(markdown);
}

main();
