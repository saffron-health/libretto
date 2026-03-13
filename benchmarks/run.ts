import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const BENCHMARK_DEFINITIONS = [
  {
    name: "onlineMind2Web",
    path: "benchmarks/onlineMind2Web",
    aliases: ["onlineMind2Web", "onlinemind2web"],
  },
  {
    name: "webVoyager",
    path: "benchmarks/webVoyager",
    aliases: ["webVoyager", "webvoyager"],
  },
  {
    name: "webBench",
    path: "benchmarks/webBench",
    aliases: ["webBench", "webbench"],
  },
] as const;

const BENCHMARK_LOOKUP = new Map<
  string,
  (typeof BENCHMARK_DEFINITIONS)[number]
>(
  BENCHMARK_DEFINITIONS.flatMap((definition) =>
    definition.aliases.map((alias) => [alias, definition] as const),
  ),
);

const ALL_BENCHMARK_NAMES = BENCHMARK_DEFINITIONS.map(
  (definition) => definition.name,
);

export type ParsedBenchmarkArgs = {
  benchmarkFilters: string[];
  passthroughArgs: string[];
  benchmarks: string[];
  isAllBenchmarks: boolean;
};

export type BenchmarkRunRecord = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  durationText: string;
  totalCostUsd: number | null;
  exitCode: number;
  requestedArgs: string[];
  passthroughArgs: string[];
  benchmarkFilters: string[];
  benchmarks: string[];
  scope: "all" | "selected";
  resultFileCount: number;
  costTrackedResultCount: number;
};

type PersistedBenchmarkResult = {
  benchmark?: string;
  caseId?: string;
  totalCostUsd?: number | null;
};

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

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

export function parseBenchmarkArgs(requestedArgs: string[]): ParsedBenchmarkArgs {
  const benchmarkFilters: string[] = [];
  const passthroughArgs: string[] = [];
  const selectedBenchmarks: string[] = [];

  for (const arg of requestedArgs) {
    if (arg === "--") {
      continue;
    }

    const benchmark = BENCHMARK_LOOKUP.get(arg);
    if (benchmark) {
      pushUnique(benchmarkFilters, benchmark.path);
      pushUnique(selectedBenchmarks, benchmark.name);
      continue;
    }

    passthroughArgs.push(arg);
  }

  const isAllBenchmarks = selectedBenchmarks.length === 0;
  return {
    benchmarkFilters,
    passthroughArgs,
    benchmarks: isAllBenchmarks ? [...ALL_BENCHMARK_NAMES] : selectedBenchmarks,
    isAllBenchmarks,
  };
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "n/a";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function walkResultPaths(root: string): string[] {
  const resultPaths: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name === "results.json") {
        resultPaths.push(entryPath);
      }
    }
  }

  return resultPaths.sort();
}

function readPersistedBenchmarkResult(
  resultPath: string,
): PersistedBenchmarkResult | null {
  try {
    return JSON.parse(readFileSync(resultPath, "utf8")) as PersistedBenchmarkResult;
  } catch {
    return null;
  }
}

export function collectRunBenchmarkResults(args: {
  root: string;
  benchmarks: string[];
  startedAt: Date;
  finishedAt: Date;
}): PersistedBenchmarkResult[] {
  const startedAtMs = args.startedAt.getTime();
  const finishedAtMs = args.finishedAt.getTime();
  const rows: PersistedBenchmarkResult[] = [];

  for (const benchmark of args.benchmarks) {
    const runsRoot = resolve(args.root, "benchmarks", benchmark, "runs");
    for (const resultPath of walkResultPaths(runsRoot)) {
      let stats;
      try {
        stats = statSync(resultPath);
      } catch {
        continue;
      }

      if (stats.mtimeMs < startedAtMs || stats.mtimeMs > finishedAtMs) {
        continue;
      }

      const row = readPersistedBenchmarkResult(resultPath);
      if (row) {
        rows.push(row);
      }
    }
  }

  return rows;
}

export function buildBenchmarkRunRecord(args: {
  requestedArgs: string[];
  parsedArgs: ParsedBenchmarkArgs;
  startedAt: Date;
  finishedAt: Date;
  exitCode: number;
  results?: PersistedBenchmarkResult[];
}): BenchmarkRunRecord {
  const durationMs = args.finishedAt.getTime() - args.startedAt.getTime();
  const results = args.results ?? [];
  const resultCosts = results
    .map((result) => result.totalCostUsd)
    .filter((cost): cost is number => typeof cost === "number");

  return {
    startedAt: args.startedAt.toISOString(),
    finishedAt: args.finishedAt.toISOString(),
    durationMs,
    durationText: formatDuration(durationMs),
    totalCostUsd:
      resultCosts.length > 0
        ? resultCosts.reduce((sum, cost) => sum + cost, 0)
        : null,
    exitCode: args.exitCode,
    requestedArgs: [...args.requestedArgs],
    passthroughArgs: [...args.parsedArgs.passthroughArgs],
    benchmarkFilters: [...args.parsedArgs.benchmarkFilters],
    benchmarks: [...args.parsedArgs.benchmarks],
    scope: args.parsedArgs.isAllBenchmarks ? "all" : "selected",
    resultFileCount: results.length,
    costTrackedResultCount: resultCosts.length,
  };
}

export function getBenchmarkRunHistoryPath(root: string): string {
  return resolve(root, "benchmarks", "run-history.jsonl");
}

export function appendBenchmarkRunRecord(
  root: string,
  record: BenchmarkRunRecord,
): void {
  const historyPath = getBenchmarkRunHistoryPath(root);
  mkdirSync(dirname(historyPath), { recursive: true });
  appendFileSync(historyPath, `${JSON.stringify(record)}\n`, "utf8");
}

function isExecutedAsScript(): boolean {
  return (
    typeof process.argv[1] === "string" &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

export function main(argv: string[] = process.argv.slice(2)): number {
  if (argv.includes("help") || argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return 0;
  }

  const parsedArgs = parseBenchmarkArgs(argv);
  const startedAt = new Date();
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.benchmarks.config.ts",
      ...parsedArgs.passthroughArgs,
      ...parsedArgs.benchmarkFilters,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );
  const exitCode = result.status ?? 1;
  const finishedAt = new Date();
  const persistedResults = collectRunBenchmarkResults({
    root: repoRoot,
    benchmarks: parsedArgs.benchmarks,
    startedAt,
    finishedAt,
  });

  try {
    appendBenchmarkRunRecord(
      repoRoot,
      buildBenchmarkRunRecord({
        requestedArgs: argv,
        parsedArgs,
        startedAt,
        finishedAt,
        exitCode,
        results: persistedResults,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.warn(`Warning: failed to write benchmark run history: ${message}`);
  }

  return exitCode;
}

if (isExecutedAsScript()) {
  process.exit(main());
}
