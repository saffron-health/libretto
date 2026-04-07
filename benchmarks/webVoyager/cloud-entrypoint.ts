/**
 * Cloud Run task entrypoint.
 *
 * Each Cloud Run task container runs this script. It reads env vars to
 * determine which benchmark case to run, executes it, and uploads results
 * to GCS. Exit 0 on success, exit 1 on failure (Cloud Run handles retries).
 *
 * Expected env vars:
 *   CLOUD_RUN_TASK_INDEX — 0-based task index assigned by Cloud Run
 *   BENCH_RUN_ID         — unique run identifier (e.g. "2026-03-27-a1b2c3")
 *   BENCH_SELECTION      — JSON-encoded selection params for selectWebVoyagerRows
 */

import { readWebVoyagerRows, selectWebVoyagerRows } from "./dataset.js";
import { getRunName } from "./prompt.js";
import { runWebVoyagerCase } from "./runner.js";
import { createBenchmarksBucket, uploadRunDirectory } from "./gcs.js";
import { ensureKernelApiKey } from "./kernel-session.js";

async function main(): Promise<void> {
  const taskIndex = Number(process.env.CLOUD_RUN_TASK_INDEX ?? "0");
  const runId = process.env.BENCH_RUN_ID;
  const selectionJson = process.env.BENCH_SELECTION;

  if (!runId) {
    throw new Error("Missing required env var: BENCH_RUN_ID");
  }
  if (!selectionJson) {
    throw new Error("Missing required env var: BENCH_SELECTION");
  }

  // Fail fast if Kernel credentials are missing — before any agent work
  await ensureKernelApiKey();

  // Re-derive the full selection deterministically, then pick this task's row
  const selectionParams = JSON.parse(selectionJson) as {
    offset?: number;
    count?: number;
    seed?: number;
    random?: boolean;
  };
  const selection = selectWebVoyagerRows(readWebVoyagerRows(), selectionParams);

  if (taskIndex < 0 || taskIndex >= selection.rows.length) {
    throw new Error(
      `CLOUD_RUN_TASK_INDEX ${taskIndex} is out of range for ${selection.rows.length} selected cases`,
    );
  }

  const row = selection.rows[taskIndex];
  const runName = getRunName(row);

  console.log(
    `[task ${taskIndex}] Running case ${row.id} (${runName}): ${row.ques}`,
  );

  // Run the benchmark case
  const result = await runWebVoyagerCase(row);

  console.log(
    `[task ${taskIndex}] ${result.status === "passed" ? "PASSED" : "FAILED"} (${result.judge.evaluation}) ${row.id}: ${result.judge.reasoning}`,
  );

  // Upload the case's run directory to GCS
  const bucket = createBenchmarksBucket();
  const gcsPrefix = `runs/${runId}/cases/${runName}`;

  await uploadRunDirectory(bucket, result.runDir, gcsPrefix);

  console.log(
    `[task ${taskIndex}] Uploaded results to gs://libretto-benchmarks/${gcsPrefix}`,
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
    } else {
      console.error(error);
    }
    console.error("Cloud entrypoint failed.");
    process.exit(1);
  });
