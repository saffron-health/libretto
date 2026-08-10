# Browser harness benchmark results

Latest full-suite scores for each benchmark configuration on the 26 live-site public cases. GPT-5.6 Sol. A separate judge scores agent events; CAPTCHA, access denial, timeout, and tool failure count as incomplete. Cost, token, duration, and tool-call metrics cover the task agent, not the judge.

## How to run

Pi harnesses (Browser Use Cloud):

```bash
pnpm --dir packages/browser-tools exec tsx benchmarks/index.ts run \
  --provider browser-use \
  --concurrency 5
```

Pi `browser-tools` only (Kernel):

```bash
pnpm --dir packages/browser-tools exec tsx benchmarks/index.ts run \
  --harnesses browser-tools \
  --provider kernel \
  --concurrency 5
```

Host harnesses (Hermes / OpenClaw stock vs Browser Tools MCP):

```bash
pnpm --dir packages/browser-tools exec tsx benchmarks/index.ts run \
  --harnesses hermes-stock,hermes-browser-tools,openclaw-stock,openclaw-browser-tools \
  --provider local \
  --concurrency 1
```

## Pi harnesses (Browser Use Cloud)

July 17–20, 2026. Harnesses: `browser-tools`, `agent-browser`, `playwright-cli`, `dev-browser`. Provider: Browser Use Cloud (US proxy). Concurrency 5.

| Metric | Value |
|---|---:|
| Passed | 84/104 |
| Completed | 100/104 |
| Agent tokens | 10.79M |
| Agent cost | $19.68 |
| Tool calls | 880 |
| Wall time | 53m 43s |

| Harness | Passed |
|---|---:|
| `browser-tools` | 20/26 |
| `agent-browser` | 23/26 |
| `playwright-cli` | 22/26 |
| `dev-browser` | 19/26 |

## Pi `browser-tools` (Kernel)

July 29, 2026. Snapshot diffs off unless the agent passed `diffSnapshot: true`.

| Metric | Value |
|---|---:|
| Passed | 23/26 |
| Completed | 26/26 |
| Avg duration | 88.6s |
| Agent tokens | 1.59M |
| Agent cost | $2.78 |
| Tool calls | 239 |
| Wall time | 9m 28s |

Failures: Reddit, Walmart, and Yelp (anti-bot). Agents set `diffSnapshot: true` on 15 of 137 `browser_exec` calls (7 of 26 cases).

## Host harnesses (local Chrome)

August 9, 2026. Hermes and OpenClaw, each with stock browser tools or Libretto Browser Tools MCP. Concurrency 1. Overall 56/104 passed. Agent duration 2.4h; wall time 2h 44m.

| Lane | Browser backend |
|---|---|
| `hermes-stock` | Hermes built-in browser (local Chromium) |
| `openclaw-stock` | Local headless Chrome (`/usr/bin/google-chrome-stable`, `noSandbox`) |
| `hermes-browser-tools`, `openclaw-browser-tools` | Libretto Browser Tools MCP → local Playwright Chromium (`--provider local`, headless) |

`--provider local` affects MCP lanes only. Host harnesses set `PLAYWRIGHT_BROWSERS_PATH` on the MCP server env so isolated `HOME` does not reinstall Chromium per attempt.

| Harness | Passed | Avg duration | Agent tokens | Agent cost | Tool calls |
|---|---:|---:|---:|---:|---:|
| `hermes-stock` | 15/26 | 72.1s | 7.92M | $7.26 | 26 |
| `hermes-browser-tools` | 14/26 | 69.8s | 3.61M | $4.50 | 26 |
| `openclaw-stock` | 13/26 | 113.6s | 19.06M | $19.43 | 301 |
| `openclaw-browser-tools` | 14/26 | 77.7s | 5.69M | $7.63 | 174 |

Pairwise stock vs Browser Tools MCP:

| Host | Stock pass | MCP pass | Judgment agreement | Both-pass mean MCP/stock tokens | Both-pass mean MCP/stock cost |
|---|---:|---:|---:|---:|---:|
| Hermes | 15/26 | 14/26 | 23/26 (88%) | 1.27x (n=13) | 1.00x (n=13) |
| OpenClaw | 13/26 | 14/26 | 25/26 (96%) | 0.59x (n=13) | 0.54x (n=13) |

Hermes stock led MCP by one pass; MCP still spent less overall. OpenClaw MCP beat stock by one pass and cut both-pass tokens and cost roughly in half. OpenClaw stock used many more tool calls (301 vs 174).

All four failed: Google, Reddit, Walmart, Expedia, DoorDash, Uber Eats, Zillow, Realtor, Yelp, npm. All four passed: Airbnb, Apple, Best Buy, books to scrape, Craigslist, GitHub, Hacker News, LinkedIn, MDN, Wikipedia, YouTube.

## Notes

- Anti-bot blocks drive most shared failures across suites.
- Host lanes trail the Pi Kernel `browser-tools` baseline (23/26). That gap mixes agent stack, prompts, and provider effects.
- These scores are exploratory. Live content, provider reputation, and anti-bot state change between runs.
