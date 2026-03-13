# Benchmarks

Benchmarks are live browser-agent tasks that run a coding agent with:

- the repo-local Libretto CLI via `pnpm cli`
- the Libretto skill injected through the Claude eval harness
- a preconfigured snapshot analyzer so `pnpm cli snapshot` works during the run
- default benchmark models of `claude-opus-4-6` for the main agent and `claude-sonnet-4-6` for snapshot analysis

Usage:

```bash
pnpm benchmark
pnpm benchmark onlineMind2Web
pnpm benchmark webVoyager
pnpm benchmark webBench
```

Current status:

- `onlineMind2Web/` is wired end-to-end with one hardcoded published example task.
- `webVoyager/` uses a browser-use-derived dataset with impossible tasks removed and stale date-based prompts updated. It runs the full local file by default, with optional env vars for bounded or seeded-random slices.
- `webBench/` is scaffolded for follow-up tasks.

Run artifacts are written to:

```text
benchmarks/run-history.jsonl
benchmarks/<benchmark>/runs/<test-name>/
  logs/
  workspace/
  results.json
  transcript.json
  transcript.md
```

`benchmarks/run-history.jsonl` appends one entry per `pnpm benchmark ...` invocation, including:

- requested benchmark selection
- passthrough Vitest args
- exit code
- overall wall-clock duration for the benchmark command
- total benchmark cost for the invocation when Claude reports usage

Each run gets its own isolated benchmark workspace. That workspace contains:

- a copied `dist/` build of the Libretto CLI
- a local `package.json` with `pnpm cli` pointing directly at `dist/cli/index.js`
- a copied `.agents/skills/libretto/SKILL.md`
- its own `.libretto/` runtime state and benchmark snapshot-analyzer config

Each per-case `results.json` now also records Claude-reported usage and `totalCostUsd`, and the generated benchmark summary includes a run-level duration/cost table plus per-case duration and cost.

Model overrides:

```bash
LIBRETTO_BENCHMARK_MODEL=claude-opus-4-6
LIBRETTO_BENCHMARK_ANALYZER_MODEL=claude-sonnet-4-6
```
