import { z } from "zod";
import { ExecutionsClient } from "@google-cloud/run";
import { SimpleCLI } from "../libretto-internals.js";
import { dispatchGcpRun } from "./cloud-dispatch.js";
import {
  countCompletedCases,
  createBenchmarksBucket,
  downloadResults,
  listRunIds,
  readManifest,
  type RunManifest,
} from "./gcs.js";
import { runWebVoyagerBenchmark } from "./runner.js";

const webVoyagerRunInput = SimpleCLI.input({
  positionals: [],
  named: {
    offset: SimpleCLI.option(z.coerce.number().int().nonnegative().optional(), {
      help: "Start at this case index for contiguous runs",
    }),
    count: SimpleCLI.option(z.coerce.number().int().positive().optional(), {
      help: "Number of cases to run",
    }),
    seed: SimpleCLI.option(z.coerce.number().int().optional(), {
      help: "Seed for random selection (default: 1)",
    }),
    random: SimpleCLI.flag({
      help: "Select a seeded random sample instead of a contiguous slice",
    }),
    parallelize: SimpleCLI.option(
      z.coerce.number().int().positive().optional(),
      {
        help: "Run up to N cases in parallel (default: sequential)",
      },
    ),
    gcp: SimpleCLI.flag({
      help: "Dispatch to GCP Cloud Run instead of running locally",
    }),
  },
})
  .refine(
    (input) => !input.random || input.offset == null,
    "--offset cannot be used with --random.",
  )
  .refine(
    (input) => input.random || input.seed == null,
    "--seed requires --random.",
  );

const webVoyagerQueryInput = SimpleCLI.input({
  positionals: [],
  named: {
    run: SimpleCLI.option(z.string().optional(), {
      help: "Run ID (defaults to the most recent GCS-backed run)",
    }),
  },
});

type ExecutionProgress = {
  taskCount: number;
  runningCount: number;
  succeededCount: number;
  failedCount: number;
  cancelledCount: number;
  retriedCount: number;
  pendingCount: number;
  status: string;
  logUri: string | null;
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "Z");
}

function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs == null || !Number.isFinite(durationMs)) {
    return "-";
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(1)}m`;
  }

  return `${(minutes / 60).toFixed(1)}h`;
}

function formatError(error: string | null | undefined): string {
  if (!error) {
    return "-";
  }

  const singleLine = error.replace(/\s+/g, " ").trim();
  return singleLine.length <= 60 ? singleLine : `${singleLine.slice(0, 57)}...`;
}

function toCount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
  ) {
    const parsed = value.toNumber();
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => {
    const rowWidth = Math.max(
      0,
      ...rows.map((row) => (row[index] ?? "").length),
    );
    return Math.max(header.length, rowWidth);
  });

  const renderRow = (row: string[]): string =>
    row.map((cell, index) => (cell ?? "").padEnd(widths[index]!)).join("  ");

  return [
    renderRow(headers),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(renderRow),
  ].join("\n");
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(items.length);
  let index = 0;

  async function next(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await worker(items[currentIndex]!);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => next(),
  );
  await Promise.all(workers);

  return results;
}

async function loadAllRunManifests(
  bucket: ReturnType<typeof createBenchmarksBucket>,
) {
  const runIds = await listRunIds(bucket);
  const manifestResults = await mapWithConcurrency(runIds, 8, async (runId) => {
    try {
      return {
        ok: true as const,
        manifest: await readManifest(bucket, runId),
      };
    } catch (error) {
      return {
        ok: false as const,
        runId,
        error,
      };
    }
  });

  return manifestResults
    .flatMap((result) => {
      if (result.ok) {
        return [result.manifest];
      }

      const message =
        result.error instanceof Error
          ? result.error.message
          : String(result.error);
      console.warn(
        `Warning: failed to read manifest for ${result.runId}: ${message}`,
      );
      return [];
    })
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
}

async function resolveManifest(
  bucket: ReturnType<typeof createBenchmarksBucket>,
  runId?: string,
): Promise<RunManifest> {
  if (runId) {
    try {
      return await readManifest(bucket, runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read run ${runId}: ${message}`);
    }
  }

  const manifests = await loadAllRunManifests(bucket);
  if (manifests.length === 0) {
    throw new Error("No GCS-backed WebVoyager runs found.");
  }

  return manifests[0]!;
}

async function readExecutionProgress(
  executionName: string,
): Promise<ExecutionProgress | null> {
  if (!executionName || executionName === "unknown") {
    return null;
  }

  const client = new ExecutionsClient();
  const [execution] = await client.getExecution({ name: executionName });

  const taskCount = toCount(execution.taskCount);
  const runningCount = toCount(execution.runningCount);
  const succeededCount = toCount(execution.succeededCount);
  const failedCount = toCount(execution.failedCount);
  const cancelledCount = toCount(execution.cancelledCount);
  const retriedCount = toCount(execution.retriedCount);
  const pendingCount = Math.max(
    0,
    taskCount - runningCount - succeededCount - failedCount - cancelledCount,
  );

  let status = "unknown";
  if (runningCount > 0) {
    status = "running";
  } else if (pendingCount > 0) {
    status = "pending";
  } else if (failedCount > 0) {
    status = "failed";
  } else if (cancelledCount > 0) {
    status = "cancelled";
  } else if (taskCount > 0 && succeededCount >= taskCount) {
    status = "succeeded";
  } else if (execution.completionTime) {
    status = "completed";
  }

  return {
    taskCount,
    runningCount,
    succeededCount,
    failedCount,
    cancelledCount,
    retriedCount,
    pendingCount,
    status,
    logUri: execution.logUri ?? null,
  };
}

async function handleList(): Promise<{ exitCode: number; stdout: string }> {
  const bucket = createBenchmarksBucket();
  const manifests = await loadAllRunManifests(bucket);

  if (manifests.length === 0) {
    return {
      exitCode: 0,
      stdout: "No GCS-backed WebVoyager runs found.",
    };
  }

  const summaries = await mapWithConcurrency(
    manifests,
    8,
    async (manifest) => ({
      manifest,
      summary: await countCompletedCases(bucket, manifest.runId),
    }),
  );

  return {
    exitCode: 0,
    stdout: renderTable(
      ["RUN ID", "STARTED", "TOTAL", "COMPLETED", "PASSED", "FAILED"],
      summaries.map(({ manifest, summary }) => [
        manifest.runId,
        formatTimestamp(manifest.startedAt),
        String(manifest.totalCases),
        String(summary.completed),
        String(summary.passed),
        String(summary.failed),
      ]),
    ),
  };
}

async function handleStatus(args: {
  input: {
    run?: string;
  };
}): Promise<{ exitCode: number; stdout: string }> {
  const bucket = createBenchmarksBucket();
  const manifest = await resolveManifest(bucket, args.input.run);
  const summary = await countCompletedCases(bucket, manifest.runId);

  let executionProgress: ExecutionProgress | null = null;
  try {
    executionProgress = await readExecutionProgress(manifest.executionName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Warning: failed to read Cloud Run execution ${manifest.executionName}: ${message}`,
    );
  }

  const lines = [
    `Run: ${manifest.runId}`,
    `Started: ${formatTimestamp(manifest.startedAt)}`,
    `Model: ${manifest.model}`,
    `Execution: ${manifest.executionName || "-"}`,
    executionProgress?.logUri ? `Logs: ${executionProgress.logUri}` : null,
    "",
    "Uploaded results:",
    `  completed: ${summary.completed}/${manifest.totalCases}`,
    `  passed: ${summary.passed}`,
    `  failed: ${summary.failed}`,
    executionProgress
      ? ""
      : "Cloud Run progress unavailable (execution metadata missing).",
    executionProgress ? "Cloud Run:" : null,
    executionProgress ? `  status: ${executionProgress.status}` : null,
    executionProgress ? `  running: ${executionProgress.runningCount}` : null,
    executionProgress ? `  pending: ${executionProgress.pendingCount}` : null,
    executionProgress
      ? `  succeeded: ${executionProgress.succeededCount}`
      : null,
    executionProgress ? `  failed: ${executionProgress.failedCount}` : null,
    executionProgress
      ? `  cancelled: ${executionProgress.cancelledCount}`
      : null,
    executionProgress ? `  retried: ${executionProgress.retriedCount}` : null,
  ].filter((line): line is string => line !== null);

  return {
    exitCode: 0,
    stdout: lines.join("\n"),
  };
}

async function handleResults(args: {
  input: {
    run?: string;
  };
}): Promise<{ exitCode: number; stdout: string }> {
  const bucket = createBenchmarksBucket();
  const manifest = await resolveManifest(bucket, args.input.run);
  const results = await downloadResults(bucket, manifest.runId);
  const resultsByRunName = new Map(
    results.map(({ runName, result }) => [runName, result]),
  );

  const rows = manifest.cases.map((manifestCase) => {
    const result = resultsByRunName.get(manifestCase.runName);
    return [
      manifestCase.caseId,
      result?.status ?? "pending",
      result?.judge.evaluation ?? "-",
      result ? formatDuration(result.durationMs) : "-",
      formatError(result?.error),
    ];
  });

  const passedCount = rows.filter(([, status]) => status === "passed").length;
  const failedCount = rows.filter(([, status]) => status === "failed").length;
  const pendingCount = rows.filter(([, status]) => status === "pending").length;
  const completedCount = manifest.totalCases - pendingCount;

  return {
    exitCode: 0,
    stdout: [
      `Run: ${manifest.runId}`,
      `Started: ${formatTimestamp(manifest.startedAt)}`,
      `Completed: ${completedCount}/${manifest.totalCases}`,
      `Passed: ${passedCount}`,
      `Failed: ${failedCount}`,
      `Pending: ${pendingCount}`,
      "",
      renderTable(["CASE ID", "STATUS", "VERDICT", "DURATION", "ERROR"], rows),
    ].join("\n"),
  };
}

export const webVoyagerCommands = SimpleCLI.group({
  description: "WebVoyager benchmark commands",
  routes: {
    run: SimpleCLI.command({
      description: "Run WebVoyager benchmark cases",
    })
      .input(webVoyagerRunInput)
      .handle(async ({ input }) => {
        if (input.gcp) {
          const { runId, totalCases, parallelism } = await dispatchGcpRun({
            offset: input.offset,
            count: input.count,
            seed: input.seed,
            random: input.random,
          });
          return {
            exitCode: 0,
            stdout: `Dispatched run ${runId} (${totalCases} cases, parallelism ${parallelism})\nCheck status: pnpm benchmarks webVoyager status --run ${runId}`,
          };
        }

        return runWebVoyagerBenchmark({
          offset: input.offset,
          count: input.count,
          seed: input.seed,
          random: input.random,
          parallelize: input.parallelize,
        });
      }),
    list: SimpleCLI.command({
      description: "List GCS-backed WebVoyager benchmark runs",
    }).handle(handleList),
    status: SimpleCLI.command({
      description: "Show progress for a GCS-backed WebVoyager benchmark run",
    })
      .input(webVoyagerQueryInput)
      .handle(handleStatus),
    results: SimpleCLI.command({
      description:
        "Show aggregated results for a GCS-backed WebVoyager benchmark run",
    })
      .input(webVoyagerQueryInput)
      .handle(handleResults),
  },
});
