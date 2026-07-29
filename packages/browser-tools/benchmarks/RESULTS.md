# Browser harness benchmark results

Results from three full Browser Use Cloud runs completed July 17–20, 2026, plus a later `browser-tools`-only Kernel re-run on July 29, 2026 after snapshot diffs became opt-in.

## Methodology

- 26 live-site tasks across search, commerce, travel, delivery, real estate, and documentation sites.
- Four harnesses in the July 17–20 suite: `browser-tools`, `agent-browser`, `playwright-cli`, and `dev-browser`.
- GPT-5.6 Sol ran through the Pi agent with concurrency 5.
- July 17–20 runs used Browser Use Cloud with a US proxy. Every full run scheduled 104 attempts: 26 tasks per harness.
- The July 29 re-run used Kernel and only the `browser-tools` harness (26 attempts), with opt-in `diffSnapshot` on `browser_exec`.
- A separate judge scored raw Pi events. Reporting a CAPTCHA, access denial, timeout, or tool failure counted as incomplete.
- Cost, token, duration, and tool-call metrics below cover the task agent, not the judge.

Browser Use Cloud suite command:

```bash
pnpm --dir packages/browser-tools exec tsx benchmarks/index.ts run \
  --provider browser-use \
  --concurrency 5
```

Kernel `browser-tools` re-run command:

```bash
pnpm --dir packages/browser-tools exec tsx benchmarks/index.ts run \
  --harnesses browser-tools \
  --provider kernel \
  --concurrency 5
```

## Latest `browser-tools` run (Kernel, opt-in diffs)

July 29, 2026. Snapshot diffs were off unless the agent passed `diffSnapshot: true`.

| Metric | Value |
|---|---:|
| Passed | 23/26 |
| Completed | 26/26 |
| Avg duration | 88.6s |
| Agent tokens | 1.59M |
| Agent cost | $2.78 |
| Tool calls | 239 |
| Wall time | 9m 28s |

Failures were all anti-bot: Reddit, Walmart, and Yelp. Agents set `diffSnapshot: true` on 15 of 137 `browser_exec` calls (7 of 26 cases).

Compared with the best prior Browser Use `browser-tools` row (24/26, 1.45M tokens, $2.53, 85.9s avg), this run was one pass lower and about 10% higher on tokens and cost. Excluding the long Walmart bot-check failure (170k tokens, $0.23, 239s), the remaining tasks were 1.42M tokens, $2.54, and 82.6s avg — on par with that earlier best. Provider differs (Kernel vs Browser Use), so the comparison is not causal for the opt-in change.

## Full runs (Browser Use Cloud, all harnesses)

| Run | Passed | Completed | Pass rate | Agent tokens | Agent cost | Tool calls | Wall time |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 86/104 | 101/104 | 82.7% | 11.62M | $21.05 | 789 | 46m 13s |
| 2 | 93/104 | 104/104 | 89.4% | 11.70M | $21.39 | 844 | 36m 16s |
| 3 | 84/104 | 100/104 | 80.8% | 10.79M | $19.68 | 880 | 53m 43s |

Harness scores by run:

| Harness | Run 1 | Run 2 | Run 3 |
|---|---:|---:|---:|
| `browser-tools` | 21/26 | 24/26 | 20/26 |
| `agent-browser` | 23/26 | 23/26 | 23/26 |
| `playwright-cli` | 21/26 | 22/26 | 22/26 |
| `dev-browser` | 21/26 | 24/26 | 19/26 |

## Best result per harness (Browser Use Cloud)

The selection uses highest pass count, then completion count, then lower cost. These rows come from different runs and do not represent one simultaneous run.

| Harness | Selected run | Passed | Anti-bot | Other failures | Avg duration | Agent tokens | Agent cost | Cost/pass |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `browser-tools` | 2 | 24/26 | 2 | 0 | 85.9s | 1.45M | $2.53 | $0.106 |
| `agent-browser` | 1 | 23/26 | 3 | 0 | 110.1s | 2.29M | $5.41 | $0.235 |
| `playwright-cli` | 2 | 22/26 | 4 | 0 | 70.6s | 3.48M | $6.44 | $0.293 |
| `dev-browser` | 2 | 24/26 | 2 | 0 | 79.6s | 3.51M | $6.18 | $0.257 |

The best-result composite is 93/104 passed at $20.56 and 10.73M agent tokens.

## Findings

- `browser-tools` and `dev-browser` tied at 24/26 in the Browser Use suite. `browser-tools` used 59% fewer tokens and cost 59% less.
- `agent-browser` was the most stable harness at 23/26 in all three Browser Use runs.
- `playwright-cli` used the most tokens and had the highest cost per successful task.
- Anti-bot behavior dominated selected failures. In the Browser Use suite, Reddit blocked all four harnesses; Expedia blocked three; Yelp blocked three; Google blocked one. The Kernel re-run failed Reddit, Walmart, and Yelp.
- The Kernel opt-in-diff re-run (23/26) stayed in the prior `browser-tools` pass-rate band (20–24/26). The modest token and cost increase versus the Browser Use best row was driven mainly by one long Walmart challenge, not by frequent use of snapshot diffs.
- Results are exploratory, not causal harness rankings. Live content, provider, proxy reputation, anti-bot state, and agent behavior varied between runs.
