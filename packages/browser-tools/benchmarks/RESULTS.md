# Browser harness benchmark results

Results from three full Browser Use Cloud runs completed July 17–20, 2026.

## Methodology

- 26 live-site tasks across search, commerce, travel, delivery, real estate, and documentation sites.
- Four harnesses: `browser-tools`, `agent-browser`, `playwright-cli`, and `dev-browser`.
- GPT-5.6 Sol ran through the Pi agent with a Browser Use Cloud session, US proxy, and concurrency 5.
- Every full run scheduled 104 attempts: 26 tasks per harness.
- A separate judge scored raw Pi events. Reporting a CAPTCHA, access denial, timeout, or tool failure counted as incomplete.
- Cost, token, duration, and tool-call metrics below cover the task agent, not the judge.

Run command:

```bash
pnpm --dir packages/browser-tools exec tsx benchmarks/index.ts run \
  --provider browser-use \
  --concurrency 5
```

## Full runs

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

## Best result per harness

The selection uses highest pass count, then completion count, then lower cost. These rows come from different runs and do not represent one simultaneous run.

| Harness | Selected run | Passed | Anti-bot | Other failures | Avg duration | Agent tokens | Agent cost | Cost/pass |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `browser-tools` | 2 | 24/26 | 2 | 0 | 85.9s | 1.45M | $2.53 | $0.106 |
| `agent-browser` | 1 | 23/26 | 3 | 0 | 110.1s | 2.29M | $5.41 | $0.235 |
| `playwright-cli` | 2 | 22/26 | 4 | 0 | 70.6s | 3.48M | $6.44 | $0.293 |
| `dev-browser` | 2 | 24/26 | 2 | 0 | 79.6s | 3.51M | $6.18 | $0.257 |

The best-result composite is 93/104 passed at $20.56 and 10.73M agent tokens.

## Findings

- `browser-tools` and `dev-browser` tied at 24/26. `browser-tools` used 59% fewer tokens and cost 59% less.
- `agent-browser` was the most stable harness at 23/26 in all three runs.
- `playwright-cli` used the most tokens and had the highest cost per successful task.
- Anti-bot behavior dominated the selected failures. Reddit blocked all four harnesses; Expedia blocked three; Yelp blocked three; Google blocked one.
- Results are exploratory, not causal harness rankings. Live content, proxy reputation, anti-bot state, and agent behavior varied between runs.
