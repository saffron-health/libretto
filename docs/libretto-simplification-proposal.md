# Libretto Workflow Typing Cleanup

Implementation plan for simplifying the libretto workflow API surface. Reduce `LibrettoWorkflowContext` to what workflows actually need, move CLI-specific concerns out of the workflow type, and clean up dead code.

---

## 1. Slim down `LibrettoWorkflowContext`

Remove fields that are derivable from `page` or only used by the CLI runner internally.

**Remove from the type:**
- `context: BrowserContext` — always `page.context()`
- `browser: Browser` — always `page.context().browser()`
- `session: string` — CLI runner concept, no workflow reads it
- `integrationPath: string` — CLI runner concept, no workflow reads it
- `exportName: string` — CLI runner concept, no workflow reads it
- `headless: boolean` — CLI runner concept, no workflow reads it

The CLI runner (`run-integration-runtime.ts`) already has all of these in scope via `args`. They don't need to be threaded through the workflow context.

**Files to change:**
- `packages/libretto/src/shared/workflow/workflow.ts` — remove fields from type
- `packages/libretto/src/cli/workers/run-integration-runtime.ts` — stop passing removed fields when constructing context

---

## 2. Add generic `services` parameter

Add a generic type parameter for dependency injection so workflows can declare what services they need with full type safety.

```typescript
export type LibrettoWorkflowContext<S = {}> = {
  page: Page;
  logger: MinimalLogger;
  services: S;
};
```

Workflows that need services declare them in the generic:

```typescript
type MyServices = { saveFile: SaveFileFn };

export const myWorkflow = workflow<Input, Output, MyServices>(
  {},
  async (ctx, input) => {
    await ctx.services.saveFile(file); // fully typed, no cast needed
  },
);
```

Workflows that don't need services get `services: {}` by default and can ignore it.

**Files to change:**
- `packages/libretto/src/shared/workflow/workflow.ts` — add generic parameter to type, thread through `LibrettoWorkflow` class and `workflow()` function
- `packages/libretto/src/cli/workers/run-integration-runtime.ts` — pass `services: {}` when constructing context

---

## 3. Move `authProfile` to CLI flag

Remove `authProfile` from `LibrettoWorkflowMetadata`. Auth profile loading is a CLI runner concern — it tells the runner to load stored browser state (cookies/localStorage from `.libretto/profiles/<domain>.json`). In production, callers handle auth themselves. The workflow shouldn't carry this metadata.

Add `--auth-profile <domain>` as an optional flag on the `run` command. The runner resolves the storage state path from the flag. If not provided, no storage state is loaded (same as current behavior when `authProfile` is absent).

**Files to change:**
- `packages/libretto/src/shared/workflow/workflow.ts` — remove `LibrettoAuthProfile` type and `authProfile` from `LibrettoWorkflowMetadata`
- `packages/libretto/src/cli/commands/execution.ts` — add `--auth-profile` option to `run` command, pass it through to worker request
- `packages/libretto/src/cli/workers/run-integration-worker-protocol.ts` — add `authProfileDomain?: string` to `RunIntegrationWorkerRequest`
- `packages/libretto/src/cli/workers/run-integration-runtime.ts` — resolve storage state from `args.authProfileDomain` instead of `workflow.metadata.authProfile`

---

## 4. Move `pause()` to a standalone import

Move `pause` out of the workflow context and make it a top-level import from `libretto`. The function is environment-aware:
- If `NODE_ENV=production`, it's a no-op (returns immediately).
- Otherwise, it reads the session from the process args (already passed to the worker process by the CLI runner) and does the file-based signal pause.

```typescript
import { pause } from "libretto";

// Works anywhere in the workflow — no ctx needed
await pause();
```

This is simpler than injecting through context because:
- Workflows don't need to thread `ctx` through helper functions just to call pause.
- Production callers don't need to provide `pause: async () => {}` — the function handles it.
- The session info `pause` needs is already available in the process environment (the CLI worker receives it as args), not something the workflow author provides.

**Files to change:**
- `packages/libretto/src/shared/workflow/workflow.ts` — remove `pause` from `LibrettoWorkflowContext`
- `packages/libretto/src/shared/debug/pause.ts` — rewrite as the standalone `pause()` function (check `NODE_ENV`, read session from process args, do file-based signal)
- `packages/libretto/src/index.ts` — export `pause`
- `packages/libretto/src/cli/workers/run-integration-runtime.ts` — stop passing `pause` when constructing context

---

## 5. Improve CLI error message for invalid workflow exports

Keep the `LibrettoWorkflow` class and `workflow()` wrapper with its brand check. But when the CLI runner loads a file and the export isn't a valid workflow, replace the current unhelpful error with one that explains the full expected pattern:

```
Export "myExport" in /path/to/file.ts is not a valid Libretto workflow.

A workflow must be created using the workflow() function from "libretto":

  import { workflow } from "libretto";

  export const myExport = workflow<InputType, OutputType>(
    {},
    async (ctx, input) => {
      // ctx.page     — Playwright Page instance
      // ctx.logger   — MinimalLogger
      // ctx.services — injected dependencies (generic, default {})
      // input        — JSON-serializable input matching InputType
      return output; // must match OutputType
    },
  );
```

**Files to change:**
- `packages/libretto/src/cli/workers/run-integration-runtime.ts` — update the error string in `loadWorkflowExport()`

---

## 6. Delete `debugPause` / `DebugPauseSignal` dead code

`debugPause()` and `DebugPauseSignal` in `shared/debug/pause.ts` are dead code from an earlier design iteration. Nothing calls `debugPause()`. The `DebugPauseSignal` is not caught by the worker runtime — if thrown, it propagates as an unhandled error. It was replaced by the file-based `.paused/.resume` signal system and `ctx.pause()`.

**Delete:**
- `DebugPauseSignal` class
- `debugPause()` function
- `isDebugPauseSignal()` guard
- `DebugPauseDetails` type
- `DebugPauseContext` type
- All re-exports of the above from `index.ts`

**Files to change:**
- `packages/libretto/src/shared/debug/pause.ts` — delete file or gut it
- `packages/libretto/src/shared/debug/index.ts` — remove re-exports
- `packages/libretto/src/index.ts` — remove re-exports

---

## 7. Update tests

Update test fixtures and specs to match the new context shape (no `context`, `browser`, `session`, `integrationPath`, `exportName`, `headless`; add `services: {}`).

Additionally, verify standalone `pause()` works correctly: run a workflow that calls `import { pause } from "libretto"` and `await pause()` via the CLI. Confirm the workflow halts, signal files are written, `libretto resume` works, and the workflow continues from where it paused.

**Files to change:**
- `packages/libretto/test/basic.spec.ts`
- Any test fixtures that construct `LibrettoWorkflowContext`

---

## Summary

| # | Change | Effort |
|---|---|---|
| 1 | Remove `context`, `browser`, `session`, `integrationPath`, `exportName`, `headless` from context | Small |
| 2 | Add generic `services<S>` parameter to context | Small |
| 3 | Move `authProfile` to `--auth-profile` CLI flag | Medium |
| 4 | Move `pause()` to standalone import, no-op when `NODE_ENV=production` | Medium |
| 5 | Improve CLI error message for invalid workflow exports | Small |
| 6 | Delete `debugPause` / `DebugPauseSignal` dead code | Small |
| 7 | Update tests | Medium |

## Target types after changes

```typescript
// packages/libretto/src/shared/workflow/workflow.ts

export type LibrettoWorkflowMetadata = {};

export type LibrettoWorkflowContext<S = {}> = {
  page: Page;
  logger: MinimalLogger;
  services: S;
};

export type LibrettoWorkflowHandler<Input = unknown, Output = unknown, S = {}> = (
  ctx: LibrettoWorkflowContext<S>,
  input: Input,
) => Promise<Output>;

export class LibrettoWorkflow<Input = unknown, Output = unknown, S = {}> {
  public readonly [LIBRETTO_WORKFLOW_BRAND] = true;
  public readonly metadata: LibrettoWorkflowMetadata;
  private readonly handler: LibrettoWorkflowHandler<Input, Output, S>;

  constructor(
    metadata: LibrettoWorkflowMetadata,
    handler: LibrettoWorkflowHandler<Input, Output, S>,
  ) {
    this.metadata = metadata;
    this.handler = handler;
  }

  async run(ctx: LibrettoWorkflowContext<S>, input: Input): Promise<Output> {
    return this.handler(ctx, input);
  }
}

export function workflow<Input = unknown, Output = unknown, S = {}>(
  metadata: LibrettoWorkflowMetadata,
  handler: LibrettoWorkflowHandler<Input, Output, S>,
): LibrettoWorkflow<Input, Output, S> {
  return new LibrettoWorkflow(metadata, handler);
}
```

## Example: workflow authoring after changes

```typescript
import { workflow, pause } from "libretto";

type Input = { query: string };
type Output = { results: string[] };

export const myWorkflow = workflow<Input, Output>(
  {},
  async (ctx, input) => {
    await ctx.page.goto("https://example.com");
    await ctx.page.fill("#search", input.query);
    await pause(); // standalone import — no-op in production, pauses in CLI
    await ctx.page.click("#submit");
    return { results: [] };
  },
);
```

## Example: CLI usage after changes

```bash
# With auth profile
npx libretto run --auth-profile apps.availity.com workflow.ts myWorkflow

# Without auth profile
npx libretto run workflow.ts myWorkflow
```

## Example: production call site after changes

```typescript
// No pause or services boilerplate needed
const ctx = { page, logger, services: {} };
await myWorkflow.run(ctx, input);
```
