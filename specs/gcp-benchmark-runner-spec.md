# GCP Benchmark Runner

## Problem overview

The WebVoyager benchmark suite has 588 cases. Running them sequentially (or even with local `--parallelize`) takes multiple days. We need to distribute benchmark execution across many Cloud Run Job tasks so a full suite run completes in hours, not days.

## Solution overview

Add a `--gcp` flag to `pnpm benchmarks webVoyager run` that builds a Docker image from the current working tree, pushes it to Artifact Registry, and dispatches a Cloud Run Job execution where each task runs a single benchmark case. Each task self-reports results to a GCS bucket. New `list`, `status`, and `results` subcommands query GCS for run state from any machine. The GitHub Action kicks off a `--gcp` run and annotates the workflow with the run ID (no waiting).

## Goals

- `pnpm benchmarks webVoyager run --gcp --count 50 --random` dispatches to Cloud Run and prints a run ID + status command
- `pnpm benchmarks webVoyager list` shows all runs from GCS with progress summaries
- `pnpm benchmarks webVoyager status --run <id>` shows detailed progress (passed/failed/running/pending)
- `pnpm benchmarks webVoyager results --run <id>` downloads and prints an aggregated summary table
- Closing the local terminal does not affect running benchmark tasks
- The GitHub Action dispatches with `--gcp` and exits immediately with an annotation

## Non-goals

- No migrations or backfills
- No web dashboard for results
- No local Docker build caching optimization
- No automatic retry of failed cases beyond Cloud Run's built-in `maxRetries`
- No configurable GCP region/project (hardcode `us-central1` / `saffron-health`)
- No multiple cases per Cloud Run task (1 task = 1 case, simplest model)

## Future work

_Added during implementation, not during initial spec creation._

- Add an artifact-aware evaluator mode that runs a separate Pi agent loop against a completed case directory instead of relying only on a screenshot judge. Give it access to `result.json`, `transcript.jsonl`, `.libretto/sessions/*/{actions,logs,network}.jsonl`, Libretto snapshot artifacts, and evaluator screenshots so it can distinguish agent mistakes from evidence-capture failures.
- Keep the current screenshot judge as a fast baseline or fallback, but add an explicit `INVALID` or `UNVERIFIABLE` path when the evidence bundle is incomplete instead of collapsing those cases into `NO`.
- Fix `benchmarks/webVoyager/screenshot-collector.ts` so periodic capture is reliable in long-running Cloud Run cases. Replace the private Playwright connection cleanup with a supported disconnect path, add collector logs/artifacts for failed capture attempts, and align page selection with Libretto's normal session connection semantics.
- Consider promoting Libretto's own snapshot artifacts into the evaluator evidence bundle when the periodic collector produces too few screenshots.

## Important files/docs/websites for implementation

- `benchmarks/cli.ts` — CLI entrypoint and command routing
- `benchmarks/webVoyager/commands.ts` — WebVoyager CLI command definitions (flags, routing)
- `benchmarks/webVoyager/runner.ts` — Core benchmark runner: `runWebVoyagerBenchmark`, `runWebVoyagerCase`, workspace prep, result writing
- `benchmarks/webVoyager/dataset.ts` — `readWebVoyagerRows`, `selectWebVoyagerRows` (deterministic selection with seed)
- `benchmarks/webVoyager/evaluator.ts` — Screenshot-based LLM judge
- `benchmarks/webVoyager/screenshot-collector.ts` — CDP screenshot capture (uses Playwright, sharp)
- `benchmarks/webVoyager/prompt.ts` — Prompt construction and run naming
- `benchmarks/libretto-internals.ts` — Re-exports from libretto package internals
- `benchmarks/package.json` — Benchmark workspace dependencies
- `.github/workflows/benchmarks.yml` — Current GitHub Actions workflow (runs locally on runner)
- Cloud Run Jobs API: https://cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs
- Cloud Run Executions API: https://cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs.executions
- `@google-cloud/run` npm package: `JobsClient`, `ExecutionsClient` from `v2`
- `@google-cloud/storage` npm package: `Storage`, `Bucket`, `File`
- Microsoft Playwright Docker images: `mcr.microsoft.com/playwright:v1.58.2-noble` (must match repo's Playwright version)

## GCS layout

```
gs://libretto-benchmarks/
  runs/
    {runId}/
      manifest.json          # written at dispatch time
      cases/
        {caseRunName}/
          result.json
          prompt.md
          transcript.jsonl
          evaluator/
            analysis.md
            screenshots/
              screenshot-01.png
              ...
```

`manifest.json` schema:

```json
{
  "runId": "2026-03-27-a1b2c3",
  "executionName": "projects/saffron-health/locations/us-central1/jobs/webvoyager-bench/executions/...",
  "totalCases": 50,
  "model": "claude-opus-4-6",
  "startedAt": "2026-03-27T10:00:00Z",
  "selection": { "mode": "random", "count": 50, "seed": 42 },
  "cases": [
    { "index": 0, "caseId": "allrecipes-0", "runName": "allrecipes-allrecipes-0" },
    ...
  ]
}
```

## Implementation

### Phase 1: Infrastructure setup script

Create a one-time setup script that provisions the GCS bucket, Artifact Registry repository, and Cloud Run Job shell. This is run once manually and is idempotent.

- [x] Create `benchmarks/infra/setup.sh` with idempotent `gcloud` commands:
  - `gcloud storage buckets create gs://libretto-benchmarks --location=us-central1` (with `|| true` for idempotency)
  - `gcloud artifacts repositories create libretto-benchmarks --repository-format=docker --location=us-central1`
  - Create the Cloud Run Job shell: `gcloud run jobs create webvoyager-bench --region=us-central1 --image=us-central1-docker.pkg.dev/saffron-health/libretto-benchmarks/webvoyager:latest --task-timeout=7200s --max-retries=1 --cpu=4 --memory=8Gi --set-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest`
- [x] Run `bash benchmarks/infra/setup.sh` successfully (or verify resources exist if already created)

### Phase 2: Dockerfile

Build a Docker image that contains the full repo with built libretto, Playwright Chromium, and the benchmark entrypoint. Based on Microsoft's Playwright container.

- [x] Create `benchmarks/Dockerfile`:
  - Base: `mcr.microsoft.com/playwright:v1.58.2-noble` (matches repo's resolved Playwright version)
  - Install pnpm via corepack
  - Copy package manifests + libretto scripts/skills first for layer caching, then `pnpm install --frozen-lockfile`, copy rest, `pnpm build`
  - `ENTRYPOINT ["npx", "tsx", "benchmarks/webVoyager/cloud-entrypoint.ts"]`
- [x] Create a `.dockerignore` in repo root excluding `node_modules`, `.git`, `benchmarks/webVoyager/runs/`
- [x] Verify `docker build -f benchmarks/Dockerfile -t webvoyager-test .` succeeds locally

### Phase 3: GCS storage module

Add a thin GCS wrapper for uploading run directories and reading manifests/results. This is the shared IO layer used by both the cloud entrypoint (upload) and the CLI query commands (read).

```ts
import { Storage } from "@google-cloud/storage";

const BUCKET_NAME = "libretto-benchmarks";

async function uploadRunDirectory(runDir: string, gcsPrefix: string): Promise<void> {
  // Walk runDir, upload each file to gs://libretto-benchmarks/{gcsPrefix}/...
}

async function writeManifest(runId: string, manifest: RunManifest): Promise<void> {
  // Upload JSON to gs://libretto-benchmarks/runs/{runId}/manifest.json
}

async function readManifest(runId: string): Promise<RunManifest> { ... }
async function listRunIds(): Promise<string[]> { ... }
async function countCompletedCases(runId: string): Promise<CaseStatusSummary> { ... }
async function downloadResults(runId: string): Promise<CaseResult[]> { ... }
```

- [x] Add `@google-cloud/storage` to `benchmarks/package.json`
- [x] Create `benchmarks/webVoyager/gcs.ts` with: `uploadRunDirectory`, `writeManifest`, `readManifest`, `listRunIds`, `countCompletedCases`, `downloadResults`
- [x] `uploadRunDirectory` walks a local directory recursively and uploads each file preserving relative paths
- [x] Verify `pnpm --filter libretto-benchmarks exec tsx -e "import './webVoyager/gcs.ts'"` loads without errors

### Phase 4: Cloud Run task entrypoint

Create the entrypoint script that each Cloud Run task container runs. It reads env vars to determine which case to run, executes it using the existing runner, and uploads results to GCS.

```ts
// benchmarks/webVoyager/cloud-entrypoint.ts
const TASK_INDEX = Number(process.env.CLOUD_RUN_TASK_INDEX ?? "0");
const runId = process.env.BENCH_RUN_ID!;
const selectionJson = process.env.BENCH_SELECTION!; // JSON-encoded selection params

const selection = selectWebVoyagerRows(
  readWebVoyagerRows(),
  JSON.parse(selectionJson),
);
const row = selection.rows[TASK_INDEX];

const result = await runWebVoyagerCase(row);
await uploadRunDirectory(
  result.runDir,
  `runs/${runId}/cases/${getRunName(row)}`,
);
```

- [x] Create `benchmarks/webVoyager/cloud-entrypoint.ts`
- [x] Read `CLOUD_RUN_TASK_INDEX`, `BENCH_RUN_ID`, `BENCH_SELECTION` env vars
- [x] Re-derive the full selection deterministically, pick `rows[TASK_INDEX]`
- [x] Call `runWebVoyagerCase(row)` (extract it as a standalone export from `runner.ts` if not already)
- [x] Upload the case's `runDir` to GCS via `uploadRunDirectory`
- [x] Exit 0 on success, exit 1 on failure (Cloud Run handles retries)
- [x] Verify entrypoint compiles: `npx tsx --no-warnings -e "import './benchmarks/webVoyager/cloud-entrypoint.js'"`

### Phase 5: Dispatch command — `--gcp` flag on `webVoyager run`

Add the `--gcp` flag that builds+pushes the Docker image, writes the manifest to GCS, and creates a Cloud Run Job execution. Prints the run ID and status command on success.

```ts
async function dispatchGcpRun(selection: WebVoyagerSelection): Promise<{ runId: string }> {
  const runId = generateRunId(); // e.g. "2026-03-27-a1b2c3"
  const imageTag = `us-central1-docker.pkg.dev/saffron-health/libretto-benchmarks/webvoyager:${runId}`;

  await buildAndPushImage(imageTag);
  await writeManifest(runId, { ...selectionInfo, cases: selection.rows.map(...) });
  await updateAndExecuteJob(imageTag, {
    taskCount: selection.rows.length,
    parallelism: Math.min(selection.rows.length, 20),
    envOverrides: { BENCH_RUN_ID: runId, BENCH_SELECTION: JSON.stringify(selectionParams) },
  });

  return { runId };
}
```

- [x] Add `--gcp` flag to `webVoyagerRunInput` in `commands.ts` as `SimpleCLI.flag()`
- [x] Add `@google-cloud/run` to `benchmarks/package.json`
- [x] Create `benchmarks/webVoyager/cloud-dispatch.ts` with:
  - `generateRunId()` — timestamp + random suffix (e.g. `2026-03-27-a1b2c3`)
  - `buildAndPushImage(tag)` — shells out to `docker build` + `docker push`
  - `updateAndExecuteJob(imageTag, opts)` — uses `JobsClient` to update the job (new image, parallelism) then `runJob` (with taskCount override + env overrides)
  - `dispatchGcpRun(selection, selectionParams)` — orchestrates the above, writes manifest to GCS, returns run ID
- [x] Wire `--gcp` flag in `commands.ts` handler: if `--gcp`, call `dispatchGcpRun` instead of `runWebVoyagerBenchmark`
- [x] Print: `"Dispatched run {runId} ({N} cases, parallelism {P})\nCheck status: pnpm benchmarks webVoyager status --run {runId}"`
- [x] Verify `pnpm benchmarks webVoyager run --gcp --count 1 --random` dispatches successfully (manual end-to-end test)

### Phase 6: Query commands — `list`, `status`, `results`

Add three new subcommands to the `webVoyager` command group for querying run state from GCS.

```ts
// list: scan gs://libretto-benchmarks/runs/*/manifest.json
// status: read manifest + count completed cases
// results: download all result.json files and print summary table

export const webVoyagerCommands = SimpleCLI.group({
  routes: {
    run: ...,
    list: SimpleCLI.command({ description: "List all benchmark runs" }).handle(handleList),
    status: SimpleCLI.command({ description: "Show run progress" })
      .input(SimpleCLI.input({ named: { run: SimpleCLI.option(z.string(), { help: "Run ID" }) } }))
      .handle(handleStatus),
    results: SimpleCLI.command({ description: "Show run results" })
      .input(SimpleCLI.input({ named: { run: SimpleCLI.option(z.string(), { help: "Run ID" }) } }))
      .handle(handleResults),
  },
});
```

- [x] Add `list` command: calls `listRunIds()`, reads each manifest, prints table (run ID, started, total cases, completed, passed, failed)
- [x] Add `status --run <id>` command: reads manifest, calls `countCompletedCases()`, also polls Cloud Run execution status via `ExecutionsClient.getExecution()` for running/pending counts
- [x] Add `results --run <id>` command: calls `downloadResults()`, prints per-case table (case ID, status, verdict, duration, error) and aggregate pass/fail counts
- [x] If `--run` is omitted on `status`/`results`, default to the most recent run by `startedAt`
- [x] Verify `pnpm benchmarks webVoyager list` returns output (after at least one `--gcp` run)

### Phase 7: Update GitHub Action

Replace the current in-runner benchmark execution with `--gcp` dispatch. The action should exit immediately after dispatch and annotate with the run ID.

- [ ] Update `.github/workflows/benchmarks.yml`:
  - Remove Playwright install step (no longer runs locally)
  - Add `gcloud` auth step (e.g. `google-github-actions/auth@v2` with workload identity or service account key)
  - Add Docker auth step for Artifact Registry (`gcloud auth configure-docker us-central1-docker.pkg.dev`)
  - Change run command to: `pnpm benchmarks webVoyager run --gcp --count "${COUNT}" ...`
  - Capture run ID from stdout
  - Add annotation: `echo "::notice::Benchmark run dispatched: ${RUN_ID}. Check status: pnpm benchmarks webVoyager status --run ${RUN_ID}"`
  - Remove the `--wait` / artifact upload / failure check steps
- [ ] Update workflow summary to include run ID and status command
- [ ] Verify workflow file is valid YAML
