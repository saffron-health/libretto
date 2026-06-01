# Evals

Run all discovered eval cases from the repo root:

```bash
pnpm evals
```

The runner imports `evals/**/*.eval.ts` and registers cases through `evalCase`. It writes each run to `evals/runs/<run-id>/` by default, including `run.json`, `summary.json`, `summary.md`, and per-case `cases/<case-id>/result.json` records plus local debugging transcripts.

Scoring is informational. Low scores are recorded in the run artifacts; the command fails only for setup or execution errors such as missing required auth profiles, harness crashes, malformed records, or zero completed cases.

## Running and focusing cases

Run all available cases:

```bash
pnpm evals
pnpm evals run
```

Cases run in parallel by default, up to the CPU parallelism detected by Node.js.

Repeat each selected case multiple times:

```bash
pnpm evals --repeat-count 3
```

Repeats run sequentially, with cases inside each repeat running up to the detected CPU parallelism. Run-level totals, infra counts, duration, and metrics are averaged per repeat so the aggregate fields stay comparable to a one-pass suite.

Run only cases that do not declare an auth profile:

```bash
pnpm evals --no-auth
```

Focus by file path or substring:

```bash
pnpm evals basic.eval.ts
pnpm evals evals/smoke.eval.ts
```

Focus by case name with `-t` / `--testNamePattern`:

```bash
pnpm evals run -t network
pnpm evals --testNamePattern "broken selector"
```

Run workflows against a specific browser provider:

```bash
pnpm evals --provider kernel
pnpm evals --provider browserbase
```

The provider is written into the temporary eval workspace config for each case.

Temporarily focus from code with `evalCase.only(...)`. Do not commit `.only` unless the narrowed run is intentional.

Write artifacts to a specific directory:

```bash
pnpm evals --output temp/eval-run
```

Regenerate a CI-style markdown/JSON summary for the latest run, or for a specific run directory:

```bash
pnpm evals summary > temp/eval-summary.md
pnpm evals summary temp/eval-run > temp/eval-summary.md
```

This also rewrites `<run-dir>/summary.json` and `<run-dir>/summary.md`. It fails if the run has no completed result records. Pass `--allow-empty` only when intentionally inspecting an empty run directory.

Override the default evaluated agent and judge model (`openai/gpt-5.5`):

```bash
pnpm evals --model openai/gpt-5.5
```

## Public website benchmarks

The public website benchmark compares agents on the same set of live website
tasks. The shared task registry lives in `evals/public-website-benchmark.ts`.
`evals/public-websites.eval.ts` registers the full suite, while
`evals/anti-bot-public-websites.eval.ts` registers the subset that previously
did not show clear anti-bot failures.

Run the full benchmark locally:

```bash
pnpm evals public-websites.eval.ts --agents libretto,libretto-cached,browser-use --provider steel --concurrency 10
```

Run the full benchmark on Cloud Run:

```bash
pnpm evals public-websites.eval.ts --agents libretto,libretto-cached,browser-use --provider steel --concurrency 20 --gcp
```

Run the anti-bot-clean subset on Cloud Run:

```bash
pnpm evals anti-bot-public-websites.eval.ts --agents libretto,libretto-cached,browser-use --provider steel --concurrency 10 --gcp
```

`libretto-cached` replays the workflow produced by the corresponding
`libretto` target, so it must be selected with `libretto`. On Cloud Run the
dispatcher runs the suite in two phases when cached targets are present:
Libretto workflow generation runs first, independent agents such as
`browser-use` run alongside that phase, and cached workflow replay starts after
the generated workflow artifacts are uploaded.

The latest public website benchmark run documented for this branch is
`2026-05-27-95ee1a`. It covered 27 cases across three agents. The reported cost
is the agent/model cost recorded by the harness; it does not add separate
browser-session infrastructure cost.

| Agent | Cases | Score | Avg agent time | Agent cost | Tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| `libretto` | 27 | 42/54 | 390.0s | $22.1506 | 18,855,003 |
| `libretto-cached` | 27 | 46/54 | 38.5s | $0.0000 | 0 |
| `browser-use` | 27 | 45/54 | 95.0s | $3.7419 | 1,020,823 |

See `evals/references/public-website-benchmarks.md` for the benchmark design,
Cloud Run setup, artifact layout, scoring model, and analysis notes.

## Auth profiles

Checked-in and private cases can declare `authProfile: "domain.com"`. Required profiles are local maintainer files stored in `evals/profiles/<domain>.json`. The whole `evals/profiles/` directory is always gitignored and must not be committed.

Check which profiles are required and whether they exist locally:

```bash
pnpm evals profiles status
```

Create or refresh a profile interactively:

```bash
pnpm evals profiles login linkedin.com
```

The login command opens `https://<domain>` in a headed browser, waits for you to finish login, saves the Libretto profile, and copies it to `evals/profiles/<domain>.json`.

## Private local cases

`evals/private/` is always gitignored. Use it for maintainer-only evals that should stay local, such as workflows against private portals or accounts. If the directory exists, matching `evals/private/**/*.eval.ts` files run automatically with `pnpm evals`; there is no suite flag for private cases.

```ts
// evals/private/portal.eval.ts
import { evalCase } from "../eval-case.js";

evalCase(
  { name: "private portal workflow", authProfile: "portal.example.com" },
  async ({ harness }) => {
    await harness.send("Run the private portal workflow.");
  },
);
```

Private cases use the same `authProfile` behavior as checked-in cases. Store local profile files in `evals/profiles/<domain>.json`, check requirements with `pnpm evals profiles status`, and create or refresh a profile with `pnpm evals profiles login <domain>`.

Do not add profile sharing, syncing, pulling, or pushing for private cases in v1.
