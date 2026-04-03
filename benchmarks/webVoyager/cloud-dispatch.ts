/**
 * GCP dispatch — builds + pushes Docker image, writes manifest to GCS,
 * and creates a Cloud Run Job execution.
 */

import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { JobsClient } from "@google-cloud/run";
import {
  readWebVoyagerRows,
  selectWebVoyagerRows,
  type WebVoyagerSelection,
} from "./dataset.js";
import { getRunName } from "./prompt.js";
import {
  createBenchmarksBucket,
  writeManifest,
  type RunManifest,
} from "./gcs.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GCP_PROJECT = "saffron-health";
const GCP_REGION = "us-central1";
const AR_REPO = "libretto-benchmarks";
const IMAGE_BASE = `${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${AR_REPO}/webvoyager`;
const JOB_NAME = `projects/${GCP_PROJECT}/locations/${GCP_REGION}/jobs/webvoyager-bench`;
const MAX_PARALLELISM = 20;
const MODEL = "claude-opus-4-6";

const repoRoot = resolve(import.meta.dirname, "../..");
const VERBOSE_DOCKER_LOGS = process.env.BENCH_VERBOSE_DOCKER === "1";

// ---------------------------------------------------------------------------
// Run ID generation
// ---------------------------------------------------------------------------

export function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // "2026-03-27"
  const suffix = randomBytes(3).toString("hex"); // "a1b2c3"
  return `${date}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Docker build + push
// ---------------------------------------------------------------------------

export function buildAndPushImage(tag: string): void {
  console.log(`Building Docker image: ${tag}`);
  runDockerCommand(
    [
      "build",
      "--platform",
      "linux/amd64",
      "-f",
      "benchmarks/Dockerfile",
      "-t",
      tag,
      ...(VERBOSE_DOCKER_LOGS ? [] : ["--quiet"]),
      ".",
    ],
    `Failed to build Docker image ${tag}.`,
  );
  console.log(`Built Docker image: ${tag}`);

  console.log(`Pushing Docker image: ${tag}`);
  runDockerCommand(
    ["push", ...(VERBOSE_DOCKER_LOGS ? [] : ["--quiet"]), tag],
    `Failed to push Docker image ${tag}.`,
  );
  console.log(`Pushed Docker image: ${tag}`);
}

function runDockerCommand(args: string[], failurePrefix: string): string {
  try {
    return execFileSync("docker", args, {
      cwd: repoRoot,
      stdio: VERBOSE_DOCKER_LOGS ? "inherit" : ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
  } catch (error) {
    const details =
      typeof error === "object" && error !== null
        ? (error as { stdout?: string | Buffer; stderr?: string | Buffer })
        : {};
    const stdout =
      typeof details.stdout === "string"
        ? details.stdout.trim()
        : Buffer.isBuffer(details.stdout)
          ? details.stdout.toString("utf8").trim()
          : "";
    const stderr =
      typeof details.stderr === "string"
        ? details.stderr.trim()
        : Buffer.isBuffer(details.stderr)
          ? details.stderr.toString("utf8").trim()
          : "";
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(
      [
        failurePrefix,
        message,
        stdout ? `stdout:\n${truncateForCli(stdout)}` : null,
        stderr ? `stderr:\n${truncateForCli(stderr)}` : null,
        VERBOSE_DOCKER_LOGS
          ? null
          : "Re-run with BENCH_VERBOSE_DOCKER=1 for full Docker logs.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
}

function truncateForCli(output: string, maxLines = 80): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) {
    return output;
  }

  return [
    `... trimmed to last ${maxLines} lines ...`,
    ...lines.slice(-maxLines),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Cloud Run Job update + execute
// ---------------------------------------------------------------------------

export async function updateAndExecuteJob(
  imageTag: string,
  opts: {
    taskCount: number;
    parallelism: number;
    envOverrides: Record<string, string>;
  },
): Promise<{ executionName: string }> {
  const client = new JobsClient();

  // Fetch the current job to preserve existing config (secrets, resources, etc.)
  const [currentJob] = await client.getJob({ name: JOB_NAME });

  // Update image, parallelism, and taskCount on the template
  const template = currentJob.template!;
  template.parallelism = opts.parallelism;
  template.taskCount = opts.taskCount;
  template.template!.containers![0].image = imageTag;

  console.log(
    `Updating Cloud Run Job: taskCount=${opts.taskCount}, parallelism=${opts.parallelism}`,
  );
  const [updateOp] = await client.updateJob({ job: currentJob });
  await updateOp.promise();

  // Run the job with env overrides
  console.log("Starting Cloud Run Job execution…");
  const [runOp] = await client.runJob({
    name: JOB_NAME,
    overrides: {
      taskCount: opts.taskCount,
      containerOverrides: [
        {
          env: Object.entries(opts.envOverrides).map(([name, value]) => ({
            name,
            value,
          })),
        },
      ],
    },
  });

  // The operation metadata contains the execution name immediately
  const metadata = runOp.metadata as { name?: string } | undefined;
  const executionName = metadata?.name ?? "unknown";

  return { executionName };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export type SelectionParams = {
  offset?: number;
  count?: number;
  seed?: number;
  random?: boolean;
};

export async function dispatchGcpRun(
  selectionParams: SelectionParams,
): Promise<{
  runId: string;
  totalCases: number;
  parallelism: number;
}> {
  const runId = generateRunId();
  const imageTag = `${IMAGE_BASE}:${runId}`;

  // Derive the selection (same logic the entrypoint will use)
  const rows = readWebVoyagerRows();
  const selection = selectWebVoyagerRows(rows, selectionParams);
  const totalCases = selection.rows.length;
  const parallelism = Math.min(totalCases, MAX_PARALLELISM);

  // 1. Build and push Docker image
  buildAndPushImage(imageTag);

  // 2. Write manifest to GCS
  const bucket = createBenchmarksBucket();
  const manifest: RunManifest = {
    runId,
    executionName: "", // will be updated after execution starts
    totalCases,
    model: MODEL,
    browserBackend: "kernel",
    startedAt: new Date().toISOString(),
    selection: {
      mode: selection.mode,
      count: totalCases,
      seed: selection.seed,
    },
    cases: selection.rows.map((row, index) => ({
      index,
      caseId: row.id,
      runName: getRunName(row),
    })),
  };

  // 3. Create Cloud Run Job execution
  const { executionName } = await updateAndExecuteJob(imageTag, {
    taskCount: totalCases,
    parallelism,
    envOverrides: {
      BENCH_RUN_ID: runId,
      BENCH_SELECTION: JSON.stringify(selectionParams),
    },
  });

  // 4. Update manifest with execution name and write to GCS
  manifest.executionName = executionName;
  await writeManifest(bucket, runId, manifest);

  return { runId, totalCases, parallelism };
}
