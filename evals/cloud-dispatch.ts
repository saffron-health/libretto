import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { JobsClient } from "@google-cloud/run";
import {
  createEvalsBucket,
  updateManifestExecutionName,
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

  const { executionName } = await updateAndExecuteJob(imageTag, {
    taskCount: totalCases,
    parallelism,
    envOverrides: {
      EVAL_RUN_ID: runId,
    },
  });
  await updateManifestExecutionName(bucket, runId, executionName);

  return { runId, totalCases, parallelism, executionName };
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
