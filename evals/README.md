# Evals

Run all discovered eval cases from the repo root:

```bash
pnpm evals
```

The runner imports `evals/**/*.eval.ts` and registers cases through `evalCase`. If `evals/private/` exists, matching `evals/private/**/*.eval.ts` files are imported too and run with the same command. There is no suite flag for private cases.

## Private local cases

`evals/private/` is always gitignored. Use it for maintainer-only evals that should stay local, such as workflows against private portals or accounts.

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
