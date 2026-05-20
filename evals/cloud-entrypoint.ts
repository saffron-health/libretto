import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createEvalsBucket,
  downloadObject,
  evalCasePrefix,
  evalWorkflowPath,
  objectExists,
  readManifest,
  uploadRunDirectory,
  type EvalCloudTarget,
} from "./cloud-gcs.js";

const repoRoot = resolve(import.meta.dirname, "..");
const cachedWorkflowTimeoutMs = 30 * 60 * 1000;
const cachedWorkflowPollMs = 10 * 1000;

async function main(): Promise<void> {
  console.log("Eval Cloud Run entrypoint starting.");
  const runId = requireEnv("EVAL_RUN_ID");
  const taskIndex = Number(requireEnv("CLOUD_RUN_TASK_INDEX"));
  if (!Number.isInteger(taskIndex) || taskIndex < 0) {
    throw new Error(`Invalid CLOUD_RUN_TASK_INDEX: ${process.env.CLOUD_RUN_TASK_INDEX}`);
  }

  const bucket = createEvalsBucket();
  const manifest = await readManifest(bucket, runId);
  const target = manifest.targets[taskIndex];
  if (!target) {
    throw new Error(
      `CLOUD_RUN_TASK_INDEX ${taskIndex} is out of range for ${manifest.targets.length} eval target(s).`,
    );
  }

  const localRunDir = join("/tmp", "libretto-evals", runId, target.id);
  await mkdir(localRunDir, { recursive: true });

  if (target.agent === "libretto-cached") {
    await downloadGeneratedWorkflow(bucket, runId, target, localRunDir);
  }

  console.log(
    `[task ${taskIndex}] Running ${target.name} [${target.agent}] from ${target.file}`,
  );
  const exitCode = await runEvalTarget({
    runDir: localRunDir,
    target,
    model: manifest.model,
    provider: manifest.browserProvider,
    noAuth: manifest.noAuth,
  });

  const caseDir = join(localRunDir, "cases", target.id);
  if (existsSync(caseDir)) {
    await uploadRunDirectory(bucket, caseDir, evalCasePrefix(runId, target.id));
    console.log(
      `[task ${taskIndex}] Uploaded artifacts to gs://libretto-benchmarks/${evalCasePrefix(runId, target.id)}`,
    );
  } else {
    console.warn(
      `[task ${taskIndex}] No case artifact directory found at ${caseDir}.`,
    );
  }

  if (exitCode !== 0) {
    throw new Error(`Eval target exited with status ${exitCode}.`);
  }
}

async function runEvalTarget(opts: {
  runDir: string;
  target: EvalCloudTarget;
  model: string;
  provider: string;
  noAuth: boolean;
}): Promise<number> {
  const args = [
    "--dir",
    "evals",
    "-s",
    "evals",
    opts.target.file,
    "-t",
    opts.target.name,
    "--agent",
    opts.target.agent,
    "--model",
    opts.model,
    "--provider",
    opts.provider,
    "--output",
    opts.runDir,
    "--concurrency",
    "1",
    ...(opts.noAuth ? ["--no-auth"] : []),
  ];
  const env = {
    ...process.env,
    BROWSER_USE_EVAL_PYTHON:
      process.env.BROWSER_USE_EVAL_PYTHON || "/opt/browser-use-venv/bin/python",
  };

  return await new Promise<number>((resolvePromise, reject) => {
    const child = spawn("pnpm", args, {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

async function downloadGeneratedWorkflow(
  bucket: ReturnType<typeof createEvalsBucket>,
  runId: string,
  target: EvalCloudTarget,
  localRunDir: string,
): Promise<void> {
  const sourceObject = evalWorkflowPath(runId, target.baseId);
  const startedAt = Date.now();
  while (!(await objectExists(bucket, sourceObject))) {
    if (Date.now() - startedAt > cachedWorkflowTimeoutMs) {
      throw new Error(
        `Timed out waiting for cached workflow artifact gs://libretto-benchmarks/${sourceObject}.`,
      );
    }
    console.log(
      `[${target.id}] Waiting for generated workflow from ${target.baseId}.`,
    );
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, cachedWorkflowPollMs),
    );
  }

  const destination = join(
    localRunDir,
    "cases",
    target.baseId,
    "generated-workflow.ts",
  );
  await downloadObject(bucket, sourceObject, destination);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(error);
  }
  console.error("Eval Cloud Run entrypoint failed.");
  process.exit(1);
});
