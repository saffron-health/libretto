# Public website benchmarks

This reference explains how the public website benchmark was built, how to run
it, and how to interpret the artifacts. It describes the benchmark harness in
this repository rather than the separate `benchmarks/` package.

## Goal

The benchmark compares browser automation agents on the same live website tasks.
It is intended to answer three questions:

- Can the agent complete the requested task on the live website?
- Does the agent avoid or recover from anti-bot pages without changing the task?
- How much agent time, token usage, tool usage, and model cost does that path
  require?

The benchmark intentionally separates workflow creation from workflow replay for
Libretto:

- `libretto` asks an AI coding agent to create a reusable Libretto workflow,
  validate it, and report the result.
- `libretto-cached` runs the generated workflow directly with
  `libretto run`. It does not call an AI agent.
- `browser-use` asks Browser Use to perform the same task directly.

This makes `libretto-cached` an apples-to-oranges comparison with agentic runs,
but it measures the cached automation path that Libretto is designed to enable.

## Files

- `evals/public-website-benchmark.ts` contains the shared task list, scoring
  criteria, agent prompts, cached workflow replay, and registration helper.
- `evals/public-websites.eval.ts` registers all public website tasks.
- `evals/agents.ts` implements the `libretto`, `libretto-cached`, and
  `browser-use` agent adapters.
- `evals/browser-use-runner.py` runs Browser Use and writes normalized JSON
  output for the TypeScript harness.
- `evals/cloud-dispatch.ts` builds or reuses the eval image and dispatches
  Cloud Run jobs.
- `evals/cloud-entrypoint.ts` runs one Cloud Run task and uploads its artifacts.
- `evals/cloud-gcs.ts` reads and writes Cloud Run manifests, results, workflow
  files, and downloaded artifacts in GCS.
- `evals/Dockerfile` installs the repo, Playwright dependencies, and Browser Use
  into the Cloud Run image.
- `evals/infra/setup.sh` creates or updates the GCS bucket, Artifact Registry
  repository, and Cloud Run job.

## Task set

The full suite currently contains 27 public website tasks. They include retail,
travel, housing, food delivery, documentation, package registries, search, and
scraping targets. The task prompts are defined as data in
`WEBSITE_EVALS` in `evals/public-website-benchmark.ts`.

Each case is registered once and then expanded by the CLI across the selected
agents. For example, the full suite with all three agents creates 81 targets:

```text
27 website cases * 3 agents = 81 eval targets
```

## Agent instructions

The benchmark gives each agent the same website task and a short agent-specific
instruction.

For Browser Use:

```text
Use Browser Use with the configured browser provider. If you hit a CAPTCHA, bot check, access-denied page, or similar anti-bot block, call solve_captcha once, then continue if the page is solved or report blocked if it remains.
```

For Libretto:

```text
Use Libretto with the configured browser provider. When creating the workflow, first try to use captured network requests or browser-session fetches for the core data retrieval, and fall back to DOM automation only if that is not practical. If you hit a CAPTCHA, bot check, access-denied page, or similar anti-bot block, call solve_captcha once, then continue if the page is solved or report blocked if it remains.
```

Libretto also receives the workflow output requirement:

```text
Create a reusable Libretto workflow file at <workflowPath>. Validate it by running `pnpm exec libretto run <workflowPath> --headless`, then report the validated output.
```

The cached lane does not receive a natural-language task prompt. It copies the
workflow produced by the matching `libretto` target and runs:

```bash
pnpm exec libretto run generated-workflow.ts --headless
```

## Scoring

Each public website case has two scoring criteria:

- Live page evidence: the agent reached the requested website or task area,
  performed the requested search or lookup, and returned a plausible answer
  grounded in live page evidence.
- Anti-bot handling: the run did not remain blocked by CAPTCHA, bot checks,
  access-denied pages, 403 pages, unusual traffic pages, or similar anti-bot
  states after waiting and checking the intended site again.

The score is informational. Failed criteria are recorded in artifacts and
summaries. The eval command fails only when setup, execution, or result
collection fails.

The infrastructure classification is derived from the score:

- `clean-pass` means both criteria passed.
- `anti-bot-failure` means the anti-bot criterion failed.
- `ordinary-failure` means another scoring criterion failed.

## Metrics

The harness records metrics separately for the evaluated agent and the judge.
Public benchmark summaries use the agent metrics unless explicitly stated.

For `libretto`, the agent metrics come from the coding agent calls used to build
and validate the workflow.

For `libretto-cached`, the agent metrics are intentionally zero for tokens and
cost because it only runs a generated script.

For `browser-use`, the adapter records the normalized Browser Use run output:

- `durationMs` is the wall time from starting the Browser Use runner until it
  exits.
- `totalTokens`, `inputTokens`, `outputTokens`, and cache fields come from
  Browser Use usage output when available.
- `totalCostUsd` is the model cost reported by the local Browser Use run.
- `turns` and `totalToolCalls` are based on Browser Use action history.

Do not mix judge metrics into agent comparisons unless the analysis explicitly
needs end-to-end evaluation cost.

## Local runbook

Install dependencies first:

```bash
pnpm install
```

Run a one-case smoke locally:

```bash
pnpm evals public-websites.eval.ts -t quotes --agents libretto,libretto-cached,browser-use --provider steel --concurrency 1
```

Run the full suite locally:

```bash
pnpm evals public-websites.eval.ts --agents libretto,libretto-cached,browser-use --provider steel --concurrency 10
```

Generate or refresh a summary for the latest local run:

```bash
pnpm evals summary
```

Write artifacts to a deterministic directory when comparing repeated local
runs:

```bash
pnpm evals public-websites.eval.ts --agents libretto,libretto-cached,browser-use --provider steel --concurrency 10 --output temp/public-websites-run
pnpm evals summary temp/public-websites-run
```

## Cloud Run setup

Authenticate with Google Cloud and configure Docker for Artifact Registry:

```bash
pnpm google-login
```

Create or update the Cloud Run infrastructure:

```bash
bash evals/infra/setup.sh
```

The setup script manages:

- GCS bucket: `gs://libretto-benchmarks`
- Artifact Registry repository: `us-central1/libretto-benchmarks`
- Cloud Run job: `libretto-evals`
- Secret bindings for `OPENAI_API_KEY`, `KERNEL_API_KEY`, and `STEEL_API_KEY`

The Docker image installs Browser Use in a Python virtual environment and sets:

```bash
BROWSER_USE_EVAL_PYTHON=/opt/browser-use-venv/bin/python
```

## Cloud Run dispatch

Run the full suite on Cloud Run:

```bash
pnpm evals public-websites.eval.ts --agents libretto,libretto-cached,browser-use --provider steel --concurrency 20 --gcp
```

Reuse an existing image instead of building a new image:

```bash
pnpm evals public-websites.eval.ts --agents libretto,libretto-cached,browser-use --provider steel --concurrency 20 --gcp --gcp-image us-central1-docker.pkg.dev/saffron-health/libretto-benchmarks/evals:<tag>
```

`--repeat-count` is not supported with `--gcp`. Run separate Cloud Run evals
instead.

## Cloud Run execution model

When the selected agents do not include `libretto-cached`, the dispatcher starts
one Cloud Run execution containing all targets.

When `libretto-cached` is selected, the dispatcher uses two phases:

- Phase 1 starts all `libretto` targets. Independent targets, such as
  `browser-use`, run alongside phase 1 with the remaining parallelism.
- Phase 2 starts all `libretto-cached` targets after the phase 1 Libretto
  workflows have completed and uploaded `generated-workflow.ts`.

This is required because every cached target depends on the generated workflow
from the matching base Libretto target.

The dispatcher caps Cloud Run parallelism at 20. When phase 1 contains both
Libretto workflow generation and independent targets, it splits the requested
parallelism between the two lanes.

## Cloud Run status and results

List known Cloud Run-backed eval runs:

```bash
pnpm evals list
```

Poll a run:

```bash
pnpm evals status --run 2026-05-27-95ee1a
```

Print aggregated target results:

```bash
pnpm evals results --run 2026-05-27-95ee1a
```

Artifacts are stored under:

```text
gs://libretto-benchmarks/evals/runs/<run-id>/
```

Each run has:

- `manifest.json`
- `cases/<target-id>/result.json`
- `cases/<target-id>/transcript.md`
- `cases/<target-id>/transcript.jsonl`
- `cases/<target-id>/judge-transcript.md`
- `cases/<target-id>/judge-events.jsonl`
- `cases/<target-id>/generated-workflow.ts` for Libretto lanes

Local downloads used during analysis can be stored in `temp/`, but those files
are not the source of truth for Cloud Run-backed results.

## Latest benchmark run

The latest full public website run analyzed for this branch is:

```text
Run ID: 2026-05-27-95ee1a
Provider: steel
Cases: 27
Agents: libretto, libretto-cached, browser-use
Targets: 81
Requested max parallelism: 20
```

Agent summary:

| Agent | Cases | Score | Pass rate | Avg agent time | Agent cost | Tokens | Tool calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `libretto` | 27 | 42/54 | 77.8% | 390.0s | $22.1506 | 18,855,003 | 780 |
| `libretto-cached` | 27 | 46/54 | 85.2% | 38.5s | $0.0000 | 0 | 0 |
| `browser-use` | 27 | 45/54 | 83.3% | 95.0s | $3.7419 | 1,020,823 | 101 |

Token breakdown:

| Agent | Input tokens | Output tokens | Cache-read tokens |
| --- | ---: | ---: | ---: |
| `libretto` | 1,583,388 | 189,759 | 17,081,856 |
| `libretto-cached` | 0 | 0 | 0 |
| `browser-use` | 982,497 | 38,326 | 580,096 |

The cost column uses the agent cost reported by the benchmark harness. It does
not include separate Steel browser-hour cost or Browser Use Cloud product
pricing.

## Analysis notes

`libretto-cached` can score higher than `libretto` because the two lanes are
scored from separate executions. A Libretto generation run can build a valid
workflow but fail its own final live-site validation due to a transient block or
timeout. The cached lane can then replay that workflow in a fresh browser
session and pass.

Cached workflow duration includes the real wall time spent running
`libretto run`, including page waits and timeouts. The cached lane still has zero
agent tokens and zero agent cost because no AI agent is called.

Browser Use duration starts immediately before the Browser Use runner process is
started and stops after the runner exits and the provider session is closed.

The public website suite uses live sites, so prices, result ordering, site
layouts, anti-bot behavior, and availability can change between runs. Treat
single-run comparisons as directional unless they are repeated across multiple
fresh runs.
