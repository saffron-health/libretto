import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  appendBenchmarkRunRecord,
  buildBenchmarkRunRecord,
  collectRunBenchmarkResults,
  getBenchmarkRunHistoryPath,
  parseBenchmarkArgs,
} from "../benchmarks/run.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("benchmark launcher history", () => {
  test("defaults to all benchmarks when no benchmark filter is provided", () => {
    const parsed = parseBenchmarkArgs(["--testNamePattern", "FINAL_RESULT"]);

    expect(parsed.benchmarkFilters).toEqual([]);
    expect(parsed.passthroughArgs).toEqual([
      "--testNamePattern",
      "FINAL_RESULT",
    ]);
    expect(parsed.benchmarks).toEqual([
      "onlineMind2Web",
      "webVoyager",
      "webBench",
    ]);
    expect(parsed.isAllBenchmarks).toBe(true);
  });

  test("writes one jsonl record per benchmark invocation", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "libretto-benchmark-run-"));
    tempRoots.push(tempRoot);

    const resultPath = join(
      tempRoot,
      "benchmarks",
      "webVoyager",
      "runs",
      "sample-case",
      "results.json",
    );
    await mkdir(dirname(resultPath), { recursive: true });
    await writeFile(
      resultPath,
      JSON.stringify({
        benchmark: "webVoyager",
        caseId: "sample-case",
        totalCostUsd: 0.4321,
      }),
      "utf8",
    );
    await utimes(
      resultPath,
      new Date("2026-03-12T20:01:00.000Z"),
      new Date("2026-03-12T20:01:00.000Z"),
    );

    const parsed = parseBenchmarkArgs([
      "webVoyager",
      "--",
      "--testNamePattern",
      "FINAL_RESULT",
    ]);
    const results = collectRunBenchmarkResults({
      root: tempRoot,
      benchmarks: parsed.benchmarks,
      startedAt: new Date("2026-03-12T20:00:00.000Z"),
      finishedAt: new Date("2026-03-12T20:02:03.000Z"),
    });
    const record = buildBenchmarkRunRecord({
      requestedArgs: ["webVoyager", "--", "--testNamePattern", "FINAL_RESULT"],
      parsedArgs: parsed,
      startedAt: new Date("2026-03-12T20:00:00.000Z"),
      finishedAt: new Date("2026-03-12T20:02:03.000Z"),
      exitCode: 0,
      results,
    });

    appendBenchmarkRunRecord(tempRoot, record);

    const historyPath = getBenchmarkRunHistoryPath(tempRoot);
    const contents = await readFile(historyPath, "utf8");
    expect(contents).toBe(`${JSON.stringify(record)}\n`);

    const persisted = JSON.parse(contents.trim());
    expect(persisted).toMatchObject({
      durationMs: 123_000,
      durationText: "2m 03s",
      exitCode: 0,
      totalCostUsd: 0.4321,
      benchmarkFilters: ["benchmarks/webVoyager"],
      benchmarks: ["webVoyager"],
      resultFileCount: 1,
      costTrackedResultCount: 1,
      passthroughArgs: ["--testNamePattern", "FINAL_RESULT"],
      requestedArgs: ["webVoyager", "--", "--testNamePattern", "FINAL_RESULT"],
      scope: "selected",
    });
  });

  test("summary includes run-level duration and cost table", async () => {
    // @ts-expect-error -- benchmark summary helper is authored as plain .mjs
    const { buildMarkdown } = await import("../benchmarks/summarize-results.mjs");
    const markdown = buildMarkdown({
      benchmark: "webVoyager",
      runMode: "small-random",
      sampleSize: "3",
      randomSeed: "20260313",
      runUrl: "",
      artifactName: "",
      runRecord: {
        durationMs: 321_000,
        totalCostUsd: 1.2345,
        resultFileCount: 3,
        costTrackedResultCount: 2,
      },
      rows: [
        {
          caseId: "sample-case",
          status: "passed",
          durationMs: 123_000,
          totalCostUsd: 0.4321,
          finalResult: "FINAL_RESULT: https://example.com | Example",
        },
      ],
    });

    expect(markdown).toContain("- Result files: `3`");
    expect(markdown).toContain("- Cost tracked: `2`");
    expect(markdown).toContain("- Total cost: `$1.2345`");
    expect(markdown).toContain("| Benchmark Run | Duration | Cost | Result files | Cost tracked |");
    expect(markdown).toContain("| `webVoyager` | `5m 21s` | `$1.2345` | `3` | `2` |");
    expect(markdown).toContain("| `sample-case` | pass `passed` | `2m 03s` | `$0.4321` |");
  });

  test("summary lookup ignores all-benchmark history entries", async () => {
    // @ts-expect-error -- benchmark summary helper is authored as plain .mjs
    const { getLatestBenchmarkRunRecord } = await import("../benchmarks/summarize-results.mjs");
    const tempRoot = await mkdtemp(join(tmpdir(), "libretto-benchmark-summary-"));
    tempRoots.push(tempRoot);

    await mkdir(join(tempRoot, "benchmarks"), { recursive: true });
    await writeFile(
      join(tempRoot, "benchmarks", "run-history.jsonl"),
      [
        JSON.stringify({
          finishedAt: "2026-03-12T20:05:00.000Z",
          scope: "selected",
          benchmarks: ["webVoyager"],
          durationMs: 123_000,
          totalCostUsd: 0.4321,
        }),
        JSON.stringify({
          finishedAt: "2026-03-12T20:06:00.000Z",
          scope: "all",
          benchmarks: ["onlineMind2Web", "webVoyager", "webBench"],
          durationMs: 999_000,
          totalCostUsd: 9.9999,
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    expect(getLatestBenchmarkRunRecord(tempRoot, "webVoyager")).toMatchObject({
      scope: "selected",
      benchmarks: ["webVoyager"],
      durationMs: 123_000,
      totalCostUsd: 0.4321,
    });
  });

  test("summary scopes result files to the selected run window", async () => {
    // @ts-expect-error -- benchmark summary helper is authored as plain .mjs
    const { filterResultPathsForRunRecord } = await import("../benchmarks/summarize-results.mjs");
    const tempRoot = await mkdtemp(join(tmpdir(), "libretto-benchmark-results-"));
    tempRoots.push(tempRoot);

    const earlierPath = join(tempRoot, "earlier-results.json");
    const currentPath = join(tempRoot, "current-results.json");
    await writeFile(earlierPath, "{}", "utf8");
    await writeFile(currentPath, "{}", "utf8");
    await utimes(
      earlierPath,
      new Date("2026-03-12T19:59:00.000Z"),
      new Date("2026-03-12T19:59:00.000Z"),
    );
    await utimes(
      currentPath,
      new Date("2026-03-12T20:01:00.000Z"),
      new Date("2026-03-12T20:01:00.000Z"),
    );

    expect(
      filterResultPathsForRunRecord([earlierPath, currentPath], {
        startedAt: "2026-03-12T20:00:00.000Z",
        finishedAt: "2026-03-12T20:02:00.000Z",
      }),
    ).toEqual([currentPath]);
  });
});
