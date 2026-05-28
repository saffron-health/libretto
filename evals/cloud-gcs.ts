import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { Bucket, Storage } from "@google-cloud/storage";
import { z } from "zod";
import { EVAL_AGENT_NAMES } from "./agents.js";

const BUCKET_NAME = "libretto-benchmarks";
const RUNS_PREFIX = "evals/runs";

const EvalCloudTargetSchema = z.object({
  index: z.number().int().nonnegative(),
  id: z.string(),
  baseId: z.string(),
  name: z.string(),
  agent: z.enum(EVAL_AGENT_NAMES),
  file: z.string(),
});

const EvalCloudExecutionNamesSchema = z.object({
  workflowGeneration: z.string().optional(),
  independent: z.string().optional(),
  cached: z.string().optional(),
});

const EvalCloudManifestSchema = z.object({
  runId: z.string(),
  executionName: z.string(),
  executionNames: EvalCloudExecutionNamesSchema.optional(),
  totalCases: z.number().int().nonnegative(),
  model: z.string(),
  browserProvider: z.string(),
  startedAt: z.string(),
  fileFilters: z.array(z.string()),
  testNamePattern: z.string().nullable(),
  noAuth: z.boolean(),
  agents: z.array(z.enum(EVAL_AGENT_NAMES)),
  targets: z.array(EvalCloudTargetSchema),
});

const EvalCloudResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  agent: z.enum(EVAL_AGENT_NAMES),
  status: z.enum(["completed", "error", "skipped"]),
  durationMs: z.number(),
  score: z.object({
    passed: z.number(),
    total: z.number(),
    percent: z.number(),
  }),
  agentMetrics: z
    .object({
      durationMs: z.number().nullable().optional(),
      totalCostUsd: z.number().nullable().optional(),
      totalTokens: z.number().nullable().optional(),
      totalToolCalls: z.number().optional(),
    })
    .passthrough(),
  judgeMetrics: z
    .object({
      durationMs: z.number().nullable().optional(),
      totalCostUsd: z.number().nullable().optional(),
      totalTokens: z.number().nullable().optional(),
      totalToolCalls: z.number().optional(),
    })
    .passthrough(),
  error: z.string().optional(),
});

export type EvalCloudTarget = z.infer<typeof EvalCloudTargetSchema>;
export type EvalCloudExecutionNames = z.infer<typeof EvalCloudExecutionNamesSchema>;
export type EvalCloudManifest = z.infer<typeof EvalCloudManifestSchema>;
export type EvalCloudResult = z.infer<typeof EvalCloudResultSchema>;

export type EvalCloudDownloadedResult = {
  targetId: string;
  result: EvalCloudResult;
};

export type EvalCloudStatusSummary = {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
};

export function createEvalsBucket(): Bucket {
  return new Storage().bucket(BUCKET_NAME);
}

export function evalRunPrefix(runId: string): string {
  return `${RUNS_PREFIX}/${runId}`;
}

export function evalCasePrefix(runId: string, targetId: string): string {
  return `${evalRunPrefix(runId)}/cases/${targetId}`;
}

export function evalManifestPath(runId: string): string {
  return `${evalRunPrefix(runId)}/manifest.json`;
}

export function evalWorkflowPath(runId: string, targetId: string): string {
  return `${evalCasePrefix(runId, targetId)}/generated-workflow.ts`;
}

export async function uploadRunDirectory(
  bucket: Bucket,
  runDir: string,
  gcsPrefix: string,
): Promise<void> {
  const files = await walkDirectory(runDir);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < files.length) {
      const filePath = files[index];
      index += 1;
      if (!filePath) continue;
      await bucket.upload(filePath, {
        destination: `${gcsPrefix}/${relative(runDir, filePath)}`,
      });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(16, files.length) }, () => worker()),
  );
}

export async function writeManifest(
  bucket: Bucket,
  runId: string,
  manifest: EvalCloudManifest,
): Promise<void> {
  const validated = EvalCloudManifestSchema.parse(manifest);
  await bucket.file(evalManifestPath(runId)).save(
    JSON.stringify(validated, null, 2),
    {
      contentType: "application/json",
    },
  );
}

export async function readManifest(
  bucket: Bucket,
  runId: string,
): Promise<EvalCloudManifest> {
  const [contents] = await bucket.file(evalManifestPath(runId)).download();
  return EvalCloudManifestSchema.parse(JSON.parse(contents.toString("utf8")));
}

export async function updateManifestExecutionName(
  bucket: Bucket,
  runId: string,
  executionName: string,
): Promise<void> {
  const manifest = await readManifest(bucket, runId);
  await writeManifest(bucket, runId, { ...manifest, executionName });
}

export async function updateManifestExecutionNames(
  bucket: Bucket,
  runId: string,
  executionNames: Partial<EvalCloudExecutionNames>,
  executionName: string,
): Promise<void> {
  const manifest = await readManifest(bucket, runId);
  await writeManifest(bucket, runId, {
    ...manifest,
    executionName,
    executionNames: {
      ...manifest.executionNames,
      ...executionNames,
    },
  });
}

export async function listRunIds(bucket: Bucket): Promise<string[]> {
  const [files] = await bucket.getFiles({
    prefix: `${RUNS_PREFIX}/`,
    matchGlob: `${RUNS_PREFIX}/*/manifest.json`,
  });

  return files
    .map((file) => file.name.split("/")[2])
    .filter((id): id is string => Boolean(id))
    .sort();
}

export async function downloadResults(
  bucket: Bucket,
  runId: string,
): Promise<EvalCloudDownloadedResult[]> {
  const prefix = `${evalRunPrefix(runId)}/cases/`;
  const [files] = await bucket.getFiles({
    prefix,
    matchGlob: `${prefix}*/result.json`,
  });
  const results: EvalCloudDownloadedResult[] = [];

  await runWithConcurrency(files, 16, async (file) => {
    const [contents] = await file.download();
    results.push({
      targetId: extractTargetId(prefix, file.name),
      result: EvalCloudResultSchema.parse(JSON.parse(contents.toString("utf8"))),
    });
  });

  return results.sort((a, b) => a.targetId.localeCompare(b.targetId));
}

export async function countCompletedCases(
  bucket: Bucket,
  runId: string,
): Promise<EvalCloudStatusSummary> {
  const manifest = await readManifest(bucket, runId);
  const results = await downloadResults(bucket, runId);
  const completed = results.filter(({ result }) => result.status === "completed");
  const errored = results.filter(({ result }) => result.status === "error");
  const skipped = results.filter(({ result }) => result.status === "skipped");
  const passed = completed.filter(
    ({ result }) => result.score.total > 0 && result.score.passed >= result.score.total,
  );

  return {
    total: manifest.totalCases,
    completed: results.length,
    passed: passed.length,
    failed: completed.length - passed.length,
    errored: errored.length,
    skipped: skipped.length,
  };
}

export async function objectExists(
  bucket: Bucket,
  objectPath: string,
): Promise<boolean> {
  const [exists] = await bucket.file(objectPath).exists();
  return exists;
}

export async function downloadObject(
  bucket: Bucket,
  objectPath: string,
  destinationPath: string,
): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    bucket
      .file(objectPath)
      .createReadStream()
      .on("error", reject)
      .pipe(createWriteStream(destinationPath))
      .on("error", reject)
      .on("finish", resolve);
  });
}

async function walkDirectory(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDirectory(path)));
    } else if (entry.isSymbolicLink()) {
      const resolved = await stat(path);
      if (resolved.isDirectory()) {
        files.push(...(await walkDirectory(path)));
      } else if (resolved.isFile()) {
        files.push(path);
      }
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function extractTargetId(prefix: string, fileName: string): string {
  const suffix = "/result.json";
  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) {
    throw new Error(`Unexpected eval result path: ${fileName}`);
  }
  return fileName.slice(prefix.length, -suffix.length);
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;

  async function next(): Promise<void> {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      if (item !== undefined) {
        await worker(item);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => next()),
  );
}
