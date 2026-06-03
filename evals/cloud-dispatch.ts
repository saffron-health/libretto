import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { ExecutionsClient, JobsClient } from "@google-cloud/run";
import {
  createEvalsBucket,
  updateManifestExecutionName,
  updateManifestExecutionNames,
  writeManifest,
  type EvalCloudManifest,
  type EvalCloudTarget,
} from "./cloud-gcs.js";
import type { EvalAgentName } from "./agents.js";

const GCP_PROJECT = "saffron-health";
const GCP_REGION = "us-central1";
const ARTIFACT_REPO = "libretto-benchmarks";
const IMAGE_BASE = `${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${ARTIFACT_REPO}/evals`;
const JOB_NAME = `projects/${GCP_PROJECT}/locations/${GCP_REGION}/jobs/libretto-evals`;
const MAX_PARALLELISM = 20;

const repoRoot = resolve(import.meta.dirname, "..");
const verboseDockerLogs = process.env.EVAL_VERBOSE_DOCKER === "1";
const imageBuilder = process.env.EVAL_IMAGE_BUILDER?.trim() || "cloud-build";
const EXECUTION_POLL_INTERVAL_MS = 15_000;

export type EvalCloudDispatchOptions = {
  model: string;
  browserProvider: string;
  fileFilters: string[];
  testNamePattern: string | null;
  noAuth: boolean;
  agents: EvalAgentName[];
  targets: EvalCloudTarget[];
  parallelism: number | null;
  image: string | null;
};

export function generateRunId(): string {
  const date = new Date().toISOString().slice(0, 10);
  const suffix = randomBytes(3).toString("hex");
  return `${date}-${suffix}`;
}

function validateCachedTargetsHaveGenerators(targets: EvalCloudTarget[]): void {
  const librettoBaseIds = new Set(
    targets
      .filter((target) => target.agent === "libretto")
      .map((target) => target.baseId),
  );
  const missingGenerators = targets.filter(
    (target) =>
      target.agent === "libretto-cached" &&
      !librettoBaseIds.has(target.baseId),
  );
  if (missingGenerators.length === 0) return;

  const missingNames = missingGenerators
    .map((target) => target.name)
    .slice(0, 5)
    .join(", ");
  throw new Error(
    [
      "libretto-cached Cloud Run evals require the corresponding libretto target in the same run.",
      `Missing libretto generator target(s) for: ${missingNames}${missingGenerators.length > 5 ? ", ..." : ""}.`,
      "Rerun with `--agents libretto,libretto-cached`.",
    ].join("\n"),
  );
}

export function buildAndPushImage(tag: string): void {
  if (imageBuilder !== "docker") {
    process.stderr.write(`Building and pushing Docker image with Cloud Build: ${tag}\n`);
    runGcloudCommand(
      [
        "builds",
        "submit",
        "--project",
        GCP_PROJECT,
        "--config",
        "evals/cloudbuild.yaml",
        "--substitutions",
        `_IMAGE=${tag}`,
        "--timeout",
        "3600s",
        "--machine-type",
        "e2-highcpu-8",
        ".",
      ],
      `Failed to build Docker image ${tag} with Cloud Build.`,
    );
    return;
  }

  process.stderr.write(`Building Docker image: ${tag}\n`);
  runDockerCommand(
    [
      "build",
      "--platform",
      "linux/amd64",
      "-f",
      "evals/Dockerfile",
      "-t",
      tag,
      ...(verboseDockerLogs ? [] : ["--quiet"]),
      ".",
    ],
    `Failed to build Docker image ${tag}.`,
  );

  process.stderr.write(`Pushing Docker image: ${tag}\n`);
  runDockerCommand(
    ["push", ...(verboseDockerLogs ? [] : ["--quiet"]), tag],
    `Failed to push Docker image ${tag}.`,
  );
}

function splitConcurrentLaneParallelism(opts: {
  totalParallelism: number;
  workflowTargetCount: number;
  independentTargetCount: number;
}): { workflowGeneration: number; independent: number } {
  if (opts.independentTargetCount === 0) {
    return {
      workflowGeneration: Math.max(
        1,
        Math.min(opts.workflowTargetCount, opts.totalParallelism),
      ),
      independent: 0,
    };
  }
  if (opts.workflowTargetCount === 0) {
    return {
      workflowGeneration: 0,
      independent: Math.max(
        1,
        Math.min(opts.independentTargetCount, opts.totalParallelism),
      ),
    };
  }

  const workflowGeneration = Math.max(
    1,
    Math.min(opts.workflowTargetCount, Math.ceil(opts.totalParallelism / 2)),
  );
  const independentCapacity = Math.max(
    1,
    opts.totalParallelism - workflowGeneration,
  );
  return {
    workflowGeneration,
    independent: Math.max(
      1,
      Math.min(opts.independentTargetCount, independentCapacity),
    ),
  };
}

function runGcloudCommand(args: string[], failurePrefix: string): string {
  try {
    return execFileSync("gcloud", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: verboseDockerLogs ? "inherit" : ["ignore", "pipe", "pipe"],
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
        verboseDockerLogs
          ? null
          : "Re-run with EVAL_VERBOSE_DOCKER=1 for full Cloud Build logs.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
}

export async function dispatchEvalGcpRun(
  options: EvalCloudDispatchOptions,
): Promise<{
  runId: string;
  totalCases: number;
  parallelism: number;
  executionName: string;
}> {
  const runId = generateRunId();
  const requestedImage = options.image ?? process.env.EVAL_GCP_IMAGE?.trim() ?? null;
  const imageTag = requestedImage || `${IMAGE_BASE}:${runId}`;
  const totalCases = options.targets.length;
  const parallelism = Math.min(
    totalCases,
    options.parallelism ?? MAX_PARALLELISM,
    MAX_PARALLELISM,
  );
  const bucket = createEvalsBucket();

  if (totalCases === 0) {
    throw new Error("Cannot dispatch an eval Cloud Run job with zero targets.");
  }
  validateCachedTargetsHaveGenerators(options.targets);

  if (requestedImage) {
    process.stderr.write(`Reusing Docker image for Cloud Run: ${imageTag}\n`);
  } else {
    buildAndPushImage(imageTag);
  }

  const manifest: EvalCloudManifest = {
    runId,
    executionName: "",
    totalCases,
    model: options.model,
    browserProvider: options.browserProvider,
    startedAt: new Date().toISOString(),
    fileFilters: options.fileFilters,
    testNamePattern: options.testNamePattern,
    noAuth: options.noAuth,
    agents: options.agents,
    targets: options.targets,
  };
  await writeManifest(bucket, runId, manifest);

  const workflowGeneratorTargetIndices = options.targets
    .map((target, index) => ({ target, index }))
    .filter(({ target }) => target.agent === "libretto")
    .map(({ index }) => index);
  const cachedTargetIndices = options.targets
    .map((target, index) => ({ target, index }))
    .filter(({ target }) => target.agent === "libretto-cached")
    .map(({ index }) => index);
  const independentTargetIndices = options.targets
    .map((target, index) => ({ target, index }))
    .filter(({ target }) => target.agent !== "libretto" && target.agent !== "libretto-cached")
    .map(({ index }) => index);

  if (cachedTargetIndices.length > 0 && workflowGeneratorTargetIndices.length === 0) {
    throw new Error("libretto-cached Cloud Run evals require libretto in the same run.");
  }

  if (cachedTargetIndices.length > 0) {
    const concurrentPhaseParallelism = splitConcurrentLaneParallelism({
      totalParallelism: parallelism,
      workflowTargetCount: workflowGeneratorTargetIndices.length,
      independentTargetCount: independentTargetIndices.length,
    });
    process.stderr.write(
      `Starting GCP eval phase 1: ${workflowGeneratorTargetIndices.length} workflow generator target(s), parallelism ${concurrentPhaseParallelism.workflowGeneration}.\n`,
    );
    const workflowGeneration = await executeTargetIndices(imageTag, {
      runId,
      targetIndices: workflowGeneratorTargetIndices,
      parallelism: concurrentPhaseParallelism.workflowGeneration,
    });
    await updateManifestExecutionNames(
      bucket,
      runId,
      { workflowGeneration: workflowGeneration.executionName },
      workflowGeneration.executionName,
    );

    if (independentTargetIndices.length > 0) {
      process.stderr.write(
        `Starting GCP eval independent lane: ${independentTargetIndices.length} target(s), parallelism ${concurrentPhaseParallelism.independent}.\n`,
      );
      const independent = await executeTargetIndices(imageTag, {
        runId,
        targetIndices: independentTargetIndices,
        parallelism: concurrentPhaseParallelism.independent,
      });
      await updateManifestExecutionNames(
        bucket,
        runId,
        { independent: independent.executionName },
        independent.executionName,
      );
    }

    await waitForExecution(workflowGeneration.executionName);

    process.stderr.write(
      `Starting GCP eval phase 2: ${cachedTargetIndices.length} cached target(s), parallelism ${parallelism}.\n`,
    );
    const cached = await executeTargetIndices(imageTag, {
      runId,
      targetIndices: cachedTargetIndices,
      parallelism,
    });
    await updateManifestExecutionNames(
      bucket,
      runId,
      { cached: cached.executionName },
      cached.executionName,
    );
    return {
      runId,
      totalCases,
      parallelism,
      executionName: cached.executionName,
    };
  }

  const { executionName } = await executeTargetIndices(imageTag, {
    runId,
    targetIndices: options.targets.map((_, index) => index),
    parallelism,
  });
  await updateManifestExecutionName(bucket, runId, executionName);

  return { runId, totalCases, parallelism, executionName };
}

async function executeTargetIndices(
  imageTag: string,
  opts: {
    runId: string;
    targetIndices: number[];
    parallelism: number;
  },
): Promise<{ executionName: string }> {
  return await updateAndExecuteJob(imageTag, {
    taskCount: opts.targetIndices.length,
    parallelism: Math.min(opts.parallelism, opts.targetIndices.length),
    envOverrides: {
      EVAL_RUN_ID: opts.runId,
      EVAL_TARGET_INDICES: JSON.stringify(opts.targetIndices),
    },
  });
}

async function updateAndExecuteJob(
  imageTag: string,
  opts: {
    taskCount: number;
    parallelism: number;
    envOverrides: Record<string, string>;
  },
): Promise<{ executionName: string }> {
  const client = new JobsClient();
  const [currentJob] = await client.getJob({ name: JOB_NAME });
  const template = currentJob.template;
  const taskTemplate = template?.template;
  const container = taskTemplate?.containers?.[0];
  if (!template || !taskTemplate || !container) {
    throw new Error(`Cloud Run job ${JOB_NAME} is missing a container template.`);
  }

  template.parallelism = opts.parallelism;
  template.taskCount = opts.taskCount;
  container.image = imageTag;

  process.stderr.write(
    `Updating Cloud Run Job: taskCount=${opts.taskCount}, parallelism=${opts.parallelism}\n`,
  );
  const [updateOperation] = await client.updateJob({ job: currentJob });
  await updateOperation.promise();

  process.stderr.write("Starting Cloud Run Job execution.\n");
  const [runOperation] = await client.runJob({
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

  const metadata = runOperation.metadata as { name?: string } | undefined;
  return { executionName: metadata?.name ?? "unknown" };
}

async function waitForExecution(executionName: string): Promise<void> {
  if (!executionName || executionName === "unknown") {
    throw new Error("Cannot wait for Cloud Run execution with unknown name.");
  }

  const client = new ExecutionsClient();
  process.stderr.write(`Waiting for Cloud Run execution to finish: ${executionName}\n`);
  while (true) {
    const [execution] = await client.getExecution({ name: executionName });
    const taskCount = toCount(execution.taskCount);
    const succeededCount = toCount(execution.succeededCount);
    const failedCount = toCount(execution.failedCount);
    const cancelledCount = toCount(execution.cancelledCount);
    const runningCount = toCount(execution.runningCount);
    const pendingCount = Math.max(
      0,
      taskCount - succeededCount - failedCount - cancelledCount - runningCount,
    );

    process.stderr.write(
      `Cloud Run progress: ${succeededCount}/${taskCount} succeeded, ${runningCount} running, ${pendingCount} pending, ${failedCount} failed, ${cancelledCount} cancelled.\n`,
    );

    if (failedCount > 0 || cancelledCount > 0) {
      throw new Error(
        `Cloud Run execution ${executionName} did not complete successfully (${failedCount} failed, ${cancelledCount} cancelled).`,
      );
    }
    if (taskCount > 0 && succeededCount >= taskCount) return;

    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, EXECUTION_POLL_INTERVAL_MS),
    );
  }
}

function toCount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "bigint") return Number(value);
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

function runDockerCommand(args: string[], failurePrefix: string): string {
  try {
    return execFileSync("docker", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: verboseDockerLogs ? "inherit" : ["ignore", "pipe", "pipe"],
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
        verboseDockerLogs
          ? null
          : "Re-run with EVAL_VERBOSE_DOCKER=1 for full Docker logs.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
}

function truncateForCli(output: string, maxLines = 80): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;
  return [
    `... trimmed to last ${maxLines} lines ...`,
    ...lines.slice(-maxLines),
  ].join("\n");
}
