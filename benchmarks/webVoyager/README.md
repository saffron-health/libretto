# webVoyager

This benchmark uses a local WebVoyager dataset derived from browser-use's maintained copy at:

https://github.com/browser-use/eval/blob/main/data/WebVoyager_data.jsonl

```text
benchmarks/webVoyager/data/WebVoyager_data.jsonl
```

The suite materializes benchmark cases directly from that dataset.
The local copy removes the `55` impossible tasks identified in browser-use's analysis notebook:

https://github.com/browser-use/eval/blob/main/analysis.ipynb

It also picks up browser-use's prompt updates for stale date-based tasks.
That leaves `588` benchmark cases in the local dataset.

Run directories are written directly under `runs/` and are prefixed with the source site slug:

```text
benchmarks/webVoyager/runs/<site-and-case-id-and-title>/
```

Useful environment variables:

```bash
LIBRETTO_WEBVOYAGER_LIMIT=1 pnpm benchmark webVoyager
LIBRETTO_WEBVOYAGER_LIMIT=25 pnpm benchmark webVoyager
LIBRETTO_WEBVOYAGER_LIMIT=10 LIBRETTO_WEBVOYAGER_OFFSET=100 pnpm benchmark webVoyager
LIBRETTO_WEBVOYAGER_RANDOM_SAMPLE=1 LIBRETTO_WEBVOYAGER_RANDOM_SEED=20260312 LIBRETTO_WEBVOYAGER_LIMIT=10 pnpm benchmark webVoyager
```

Defaults:

- `pnpm benchmark webVoyager` runs the full local filtered dataset
- WebVoyager cases always run concurrently
- Benchmark Vitest runs use `maxWorkers=4`
- Benchmark Vitest timeout is disabled
- `LIBRETTO_WEBVOYAGER_LIMIT` is unset by default
- `LIBRETTO_WEBVOYAGER_OFFSET=0`
- `LIBRETTO_WEBVOYAGER_RANDOM_SAMPLE=0`
- `LIBRETTO_WEBVOYAGER_RANDOM_SEED=1`
- `LIBRETTO_BENCHMARK_MODEL=claude-opus-4-6`
- `LIBRETTO_BENCHMARK_ANALYZER_MODEL=claude-sonnet-4-6`
