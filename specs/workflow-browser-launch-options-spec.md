## Problem overview

Some sites (for example Marriott) block Kernel/Libretto when Playwright attaches over CDP and then navigates with `page.goto()`. Kernel succeeds when the browser is created with `start_url` before CDP attachment. GPU helps on those sites but is expensive, so it must be declared per workflow rather than defaulted globally. Workflow code already stores `startUrl`, `gpu`, and `viewport` in deploy metadata (#439), but local Kernel sessions and the cloud jobs CLI do not thread those launch options into provider session creation.

## Solution overview

Treat workflow `startUrl` / `gpu` / `viewport` as the primary browser launch config. Thread them into the Kernel provider as `start_url` / `gpu` / `viewport`, skip post-connect `page.goto` when the provider preloads `start_url`, and expose the same fields as optional overrides on `libretto cloud jobs create` and `libretto cloud schedules create`.

## Goals

- Authors declare `startUrl` and `gpu` (and optional `viewport`) once on the workflow; local Kernel `open` / `run` honor them.
- Kernel session creation receives `start_url`, `gpu`, and viewport before CDP connect, so first navigation is provider-side.
- Callers can override launch options on cloud jobs and schedules from the CLI for debugging.
- Docs describe workflow-level launch options and the CLI/API override fields.

## Non-goals

- No migrations or backfills.
- No changes in the hosted `browser-automations` executor (job inheritance from deploy metadata, job log fields). That stays a follow-up in the sibling repo; this repo ships the client contract and local Kernel behavior.
- No new provider-specific CLI flags on `open` / `run` beyond existing `--viewport` / headed flags.
- No browser-tools interface break for providers that do not need per-call options.

## Important files/docs/websites for implementation

- `packages/libretto/src/cli/core/providers/types.ts` — `ProviderApi.createSession` options.
- `packages/libretto/src/cli/core/providers/kernel.ts` — Kernel `POST /browsers` body.
- `packages/libretto/src/cli/core/daemon/config.ts` — provider daemon browser config.
- `packages/libretto/src/cli/core/daemon/daemon.ts` — provider connect + optional `page.goto`.
- `packages/libretto/src/cli/commands/cloud-jobs.ts` — hosted job create CLI.
- `packages/libretto/src/cli/commands/cloud-schedules.ts` — schedule create CLI.
- `packages/libretto/src/cli/commands/browser.ts` — `parseViewportArg` reuse.
- `packages/browser-tools/src/providers/kernel.ts` — SDK Kernel provider constructor options.
- `packages/libretto/test/browser.spec.ts` — Kernel createSession body tests.
- `packages/libretto/test/basic.spec.ts` — cloud jobs/schedules help tests.
- `docs/reference/runtime/workflow.mdx` — workflow option docs.
- `docs/libretto-cloud-api/jobs-and-logs.mdx` — jobs API fields.
- `docs/libretto-cloud-api/schedules.mdx` — schedules API fields.
- `docs/browser-tools/providers/kernel.mdx` / `docs/alternative-providers/kernel.mdx` — Kernel launch options.
- Kernel create browser API: https://www.kernel.sh/docs/api-reference/browsers/create-a-browser-session (`start_url`, `gpu`, `viewport`).

## Implementation

### Phase 1: Extend ProviderApi and Kernel createSession with launch options

Add optional `startUrl`, `gpu`, and `viewport` to provider session create options. Kernel sends them as `start_url`, `gpu`, and `viewport` on `POST /browsers`, and reports when it preloaded a start URL.

```ts
// packages/libretto/src/cli/core/providers/types.ts
export type ProviderSessionCreateOptions = {
  authProfileName?: string;
  authProfilePersist?: boolean;
  headless?: boolean;
  startUrl?: string;
  gpu?: boolean;
  viewport?: { width: number; height: number };
};

export type ProviderSession = {
  ...
  // True when the provider opened startUrl before CDP attach.
  startUrlPreloaded?: boolean;
};
```

- [x] Add `ProviderSessionCreateOptions` (or inline equivalent) with `startUrl`, `gpu`, `viewport`
- [x] Extend `ProviderSession` with optional `startUrlPreloaded`
- [x] Update Kernel provider to forward launch fields and set `startUrlPreloaded` when `startUrl` was sent
- [x] Add a unit test that `createSession({ startUrl, gpu, viewport })` posts those fields to Kernel
- [x] Verify `pnpm -s --filter libretto test -- test/browser.spec.ts` passes

### Phase 2: Preload start URL on provider connect and skip post-connect goto

When creating a provider session, pass `initialUrl` / workflow launch options into `createSession`. If the provider preloaded the start URL, do not call `page.goto` afterward.

```ts
// packages/libretto/src/cli/core/daemon/daemon.ts
providerSession = await provider.createSession({
  ...
  startUrl: config.startUrl ?? config.initialUrl,
  gpu: config.gpu,
  viewport: config.viewport,
});
...
navigateUrl: providerSession.startUrlPreloaded
  ? undefined
  : config.initialUrl,
```

- [x] Extend `DaemonBrowserProviderConfig` with optional `startUrl`, `gpu`, `viewport`
- [x] Pass launch options into `provider.createSession` from `connectToProvider`
- [x] Skip `page.goto` when `startUrlPreloaded` is true
- [x] For Kernel `open`, ensure the open URL is sent as provider `startUrl` (via `initialUrl`)
- [x] Verify `pnpm -s --filter libretto type-check` passes

### Phase 3: Promote workflow launch metadata into local provider runs

When the daemon loads a workflow for `run` against a provider, copy `startUrl` / `gpu` / `viewport` from the workflow onto the provider browser config (CLI viewport still wins when set).

```ts
// packages/libretto/src/cli/core/daemon/daemon.ts
browserConfig = mergeWorkflowLaunchIntoProviderConfig(
  { ...config.browser, authProfileName, authProfilePersist },
  {
    startUrl: loadedWorkflow.startUrl,
    gpu: loadedWorkflow.gpu,
    viewport: loadedWorkflow.viewport,
  },
);
```

- [x] Promote workflow `startUrl`, `gpu`, and `viewport` into provider browser config during daemon startup
- [x] Prefer explicit daemon/CLI viewport over workflow viewport
- [x] Add a focused unit/integration test covering Kernel create body when workflow declares launch metadata, or extend an existing provider test if that is the lightest path
- [x] Verify relevant libretto tests pass

### Phase 4: Cloud jobs and schedules CLI overrides

Add optional `--start-url`, `--gpu` / `--no-gpu`, and `--viewport` to jobs and schedules create. Map them to API fields `start_url`, `gpu`, and `viewport`.

```ts
// packages/libretto/src/cli/commands/cloud-jobs.ts
if (input.startUrl) payload.start_url = input.startUrl;
if (input.gpu) payload.gpu = true;
if (input.noGpu) payload.gpu = false;
if (viewport) payload.viewport = viewport;
```

- [x] Add the three override flags to `cloud jobs create` and `cloud schedules create`
- [x] Reject `--gpu` together with `--no-gpu`
- [x] Update help assertions in `packages/libretto/test/basic.spec.ts`
- [x] Verify `pnpm -s --filter libretto test -- test/basic.spec.ts` passes for the affected tests

### Phase 5: browser-tools Kernel constructor launch options

Mirror `startUrl`, `gpu`, and `viewport` on `KernelBrowserProviderOptions` so SDK users can declare the same Kernel create fields without changing the `BrowserProvider` interface.

```ts
// packages/browser-tools/src/providers/kernel.ts
body: JSON.stringify({
  headless: this.headless,
  stealth: this.stealth,
  ...(this.startUrl ? { start_url: this.startUrl } : {}),
  ...(this.gpu !== undefined ? { gpu: this.gpu } : {}),
  ...(this.viewport ? { viewport: this.viewport } : {}),
  ...
})
```

- [x] Add constructor options and forward them on create
- [x] Document options in `docs/browser-tools/providers/kernel.mdx`
- [x] Verify `pnpm -s --filter libretto-browser-tools type-check` (or package filter name) passes

### Phase 6: Document workflow launch options and API overrides

Document the workflow fields and the jobs/schedules override fields so authors use workflow-level declaration as the primary UX.

- [x] Document `startUrl`, `gpu`, and `viewport` on the workflow reference page
- [x] Document `start_url`, `gpu`, `viewport`, and `headless` on jobs (and schedules) API docs
- [x] Note Kernel preload behavior on alternative-providers Kernel docs
