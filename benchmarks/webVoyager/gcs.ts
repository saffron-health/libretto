import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { Bucket, Storage } from "@google-cloud/storage";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUCKET_NAME = "libretto-benchmarks";

// ---------------------------------------------------------------------------
// Schemas -- mirrors GCS layout from the spec
// ---------------------------------------------------------------------------

const ManifestCaseSchema = z.object({
  index: z.number(),
  caseId: z.string(),
  runName: z.string(),
});

const RunManifestSchema = z.object({
  runId: z.string(),
  executionName: z.string(),
  totalCases: z.number(),
  model: z.string(),
  startedAt: z.string(),
  selection: z.object({
    mode: z.enum(["slice", "random"]),
    count: z.number(),
    seed: z.nullable(z.number()),
  }),
  cases: z.array(ManifestCaseSchema),
});

const JudgeResultSchema = z.object({
  evaluation: z.enum(["YES", "NO", "INVALID"]),
  reasoning: z.string(),
});

const CaseResultSchema = z.object({
  caseId: z.string(),
  runDir: z.string(),
  status: z.enum(["passed", "failed"]),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number(),
  finalMessage: z.nullable(z.string()),
  judge: JudgeResultSchema,
  screenshotCount: z.number(),
  error: z.nullable(z.string()),
  task: z.string().optional(),
  url: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type ManifestCase = z.infer<typeof ManifestCaseSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
export type CaseResult = z.infer<typeof CaseResultSchema>;
export type DownloadedCaseResult = {
  runName: string;
  result: CaseResult;
};

export type CaseStatusSummary = {
  total: number;
  completed: number;
  passed: number;
  failed: number;
};

// ---------------------------------------------------------------------------
// Bucket constructor
// ---------------------------------------------------------------------------

export function createBenchmarksBucket(): Bucket {
  return new Storage().bucket(BUCKET_NAME);
}

// ---------------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------------

/**
 * Walk a local directory recursively and upload every file, preserving
 * relative paths under gcsPrefix.
 */
export async function uploadRunDirectory(
  bucket: Bucket,
  runDir: string,
  gcsPrefix: string,
): Promise<void> {
  const files = await walkDirectory(runDir);

  // Upload in parallel with bounded concurrency
  const CONCURRENCY = 16;
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < files.length) {
      const filePath = files[idx++];
      const relPath = relative(runDir, filePath);
      const destination = gcsPrefix + "/" + relPath;
      await bucket.upload(filePath, { destination });
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, files.length) },
    () => worker(),
  );
  await Promise.all(workers);
}

async function walkDirectory(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkDirectory(fullPath)));
    } else if (entry.isSymbolicLink()) {
      // Resolve symlink and only include if it points to a regular file
      const resolved = await stat(fullPath);
      if (resolved.isDirectory()) {
        results.push(...(await walkDirectory(fullPath)));
      } else if (resolved.isFile()) {
        results.push(fullPath);
      }
      // Skip broken symlinks, sockets, etc.
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
    // Skip sockets, FIFOs, devices, and other non-regular entries
  }
  return results;
}

// ---------------------------------------------------------------------------
// Manifest operations
// ---------------------------------------------------------------------------

export async function writeManifest(
  bucket: Bucket,
  runId: string,
  manifest: RunManifest,
): Promise<void> {
  const validated = RunManifestSchema.parse(manifest);
  const file = bucket.file("runs/" + runId + "/manifest.json");
  await file.save(JSON.stringify(validated, null, 2), {
    contentType: "application/json",
  });
}

export async function readManifest(
  bucket: Bucket,
  runId: string,
): Promise<RunManifest> {
  const file = bucket.file("runs/" + runId + "/manifest.json");
  const [contents] = await file.download();
  return RunManifestSchema.parse(JSON.parse(contents.toString("utf8")));
}

// ---------------------------------------------------------------------------
// Query operations
// ---------------------------------------------------------------------------

/**
 * List all run IDs by scanning for runs/runId/manifest.json objects.
 */
export async function listRunIds(bucket: Bucket): Promise<string[]> {
  const [files] = await bucket.getFiles({
    prefix: "runs/",
    matchGlob: "runs/*/manifest.json",
  });

  return files
    .map((f) => {
      const parts = f.name.split("/");
      return parts[1];
    })
    .filter((id): id is string => !!id)
    .sort();
}

/**
 * Count completed (and passed/failed) cases for a run by listing
 * result.json objects under runs/runId/cases/.
 */
export async function countCompletedCases(
  bucket: Bucket,
  runId: string,
): Promise<CaseStatusSummary> {
  const manifest = await readManifest(bucket, runId);
  const results = await downloadResults(bucket, runId);

  let passed = 0;
  let failed = 0;

  for (const { result } of results) {
    if (result.status === "passed") passed++;
    else failed++;
  }

  return {
    total: manifest.totalCases,
    completed: passed + failed,
    passed,
    failed,
  };
}

/**
 * Download all result.json files for a run and return them as an array.
 */
export async function downloadResults(
  bucket: Bucket,
  runId: string,
): Promise<DownloadedCaseResult[]> {
  const prefix = "runs/" + runId + "/cases/";
  const [files] = await bucket.getFiles({
    prefix,
    matchGlob: prefix + "*/result.json",
  });

  const results: DownloadedCaseResult[] = [];

  await runWithConcurrency(files, 16, async (file) => {
    try {
      const [contents] = await file.download();
      results.push({
        runName: extractRunName(prefix, file.name),
        result: CaseResultSchema.parse(JSON.parse(contents.toString("utf8"))),
      });
    } catch (err) {
      console.warn("Warning: failed to read result file %s: %s", file.name, err);
    }
  });

  results.sort((a, b) => a.runName.localeCompare(b.runName));
  return results;
}

function extractRunName(prefix: string, fileName: string): string {
  const suffix = "/result.json";
  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) {
    throw new Error(`Unexpected result path: ${fileName}`);
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
      const item = items[index++];
      await worker(item);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => next(),
  );
  await Promise.all(workers);
}
