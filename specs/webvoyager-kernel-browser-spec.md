## Problem overview

The WebVoyager benchmark currently asks the agent to drive a browser through the local `libretto` CLI, which in turn launches local Playwright/Chromium. In practice, Google CAPTCHA challenges are a recurring failure mode in GCP runs, and the benchmark agent does not have a dedicated CAPTCHA-solving tool; it only tries to work through CAPTCHA flows manually with `libretto exec` scripts.

Kernel offers stealth browsers with automatic reCAPTCHA solving, but this repo does not currently have a path that puts WebVoyager’s browser sessions onto Kernel. We need the smallest realistic change that gets benchmark browser sessions onto Kernel without rewriting Libretto around a new browser-provider abstraction.

## Solution overview

Add a benchmark-owned Kernel browser bootstrap path in `benchmarks/webVoyager` that creates a Kernel browser before the Pi agent starts, navigates it to the case’s starting URL, and writes a Libretto-compatible `.libretto/sessions/<session>/state.json` that points at Kernel’s CDP WebSocket. The benchmark agent will keep using the local `npx libretto` CLI for `exec`, `snapshot`, `pages`, and `close`, but the underlying browser session will be remote and Kernel-backed instead of local Playwright.

This deliberately does **not** try to make generic `libretto open` launch Kernel in v1. That broader CLI-preserving path appears feasible later because Libretto already supports `cdpEndpoint`-backed sessions, but it would require extra lifecycle and cleanup work inside `packages/libretto/src/cli/core/browser.ts`. For the benchmark, the simpler seam is the runner-owned session bootstrap plus the existing session-state/CDP contract.

## Goals

- WebVoyager can run benchmark cases against a Kernel-backed browser session instead of the current local Libretto + Playwright browser.
- The benchmark agent continues to use the local `npx libretto ...` workflow for in-session work after startup, especially `snapshot`, `exec`, and `pages`.
- Kernel-backed runs work both locally and in GCP Cloud Run, with explicit cleanup so benchmark runs do not leak remote browser sessions.
- The spec documents a path that is feasible without major Libretto architecture changes.
- The spec is explicit that v1 preserves the local Libretto CLI for browser interaction, but does **not** preserve the exact current `npx libretto open <url>` startup step.

## Non-goals

- No migrations or backfills.
- No full Libretto-wide browser-provider abstraction.
- No attempt to move `npx libretto run ...` or the shared runtime worker onto Kernel in this spec.
- No first-class generic `libretto open --kernel` or `libretto connect` redesign in this spec.
- No switch to Kernel’s Playwright Execution API or Computer Controls API for agent actions in v1.
- No browser-pool, profile, or proxy-tuning system beyond the minimum Kernel session options needed for benchmark runs.

## Feasibility and chosen integration seam

- **Feasible without major Libretto architecture changes:** yes.
- **Why:** Libretto’s interactive commands already consume session state via `.libretto/sessions/<session>/state.json`, and `exec`, `snapshot`, `pages`, the screenshot collector, and related code already prefer `state.cdpEndpoint` when present.
- **Chosen v1 seam:** the benchmark runner will create the Kernel browser and write compatible session state before the agent starts.
- **What stays local:** the `libretto` CLI binary the agent shells out to, the per-run workspace, snapshot analysis, evaluator, and Pi agent session.
- **What becomes Kernel-backed:** the actual browser session behind that local CLI.

### Why this is the minimal path

This path only requires benchmark-specific code plus a new dependency in `benchmarks/`. It avoids modifying Libretto’s local `open` launcher, detached child lifecycle, or `close` semantics.

### Why exact `npx libretto open ...` preservation is not the v1 path

Preserving the current startup UX exactly would mean teaching Libretto’s `open` path to provision a Kernel browser, persist remote-session metadata, keep cleanup correct, and likely add first-class remote-session ownership to `close`. That looks feasible later, but it is more invasive than the benchmark needs.

### What UX is preserved in v1

- Preserved: `npx libretto snapshot`, `npx libretto exec`, `npx libretto pages`, and session-state-driven screenshot capture.
- Not preserved: the agent should not be responsible for the initial `npx libretto open <url>` step. The runner will pre-open the named session and the prompt/`AGENTS.md` will tell the agent to start from the existing session.

## Constraints and validation items

- Kernel returns a **CDP WebSocket URL** (`cdp_ws_url`), so the benchmark bootstrap must write `cdpEndpoint` into Libretto session state.
- Kernel browsers time out after inactivity by default after 60 seconds with no CDP or live-view connection, so benchmark-created sessions must request a longer `timeout_seconds`.
- Kernel requires explicit deletion by `session_id`; local `browser.close()` is not sufficient cleanup.
- Kernel docs recommend Playwright Execution API or Computer Controls over raw CDP for best bot-detection posture. This spec intentionally accepts CDP because Libretto’s current interactive commands are CDP-based.
- The current benchmark evaluator depends on screenshots plus final assistant text, not on Libretto action/network telemetry. The v1 path therefore does not need to reproduce the local `open` child’s continuous telemetry logging.
- We still need one real smoke run against a CAPTCHA-prone case to validate that Kernel stealth mode materially improves benchmark reliability when the agent continues using Libretto over CDP.

## Future work

_Added during implementation, not during initial spec creation._

## Important files/docs/websites for implementation

- `benchmarks/webVoyager/runner.ts` — current per-case workspace setup, Pi agent session creation, screenshot collector startup, and final result writing.
- `benchmarks/webVoyager/prompt.ts` — current prompt contract; today it assumes the agent will open the session itself.
- `benchmarks/webVoyager/evaluator.ts` — confirms evaluation is screenshot/final-message based, not browser-runtime-specific.
- `benchmarks/webVoyager/commands.ts` — CLI surface for local and GCP benchmark runs; likely place to add backend selection.
- `benchmarks/webVoyager/cloud-dispatch.ts` — Cloud Run dispatch path; must propagate backend selection/env to remote tasks.
- `benchmarks/webVoyager/cloud-entrypoint.ts` — Cloud Run task entrypoint; must recreate the same backend selection when a task starts.
- `benchmarks/webVoyager/screenshot-collector.ts` — proves screenshot capture already works from `state.cdpEndpoint` and is the main compatibility contract to preserve.
- `benchmarks/package.json` — benchmark package dependency surface; add Kernel SDK here, not in the per-run workspace package.
- `packages/libretto/src/cli/core/browser.ts` — shows current local `open` path, session reconnect logic, and why generic CLI preservation is a separate follow-up.
- `packages/libretto/src/cli/commands/browser.ts` — current CLI command surface for `open`, `connect`, and `close`.
- `packages/libretto/src/cli/core/session.ts` — session-state read/write behavior used by interactive Libretto commands.
- `packages/libretto/src/shared/state/session-state.ts` — schema for `.libretto/sessions/<session>/state.json`; the benchmark-owned Kernel bootstrap must stay compatible with this shape.
- `packages/libretto/src/shared/run/browser.ts` — separate runtime launch path for `libretto run`; included to make the v1 non-goal explicit.
- `packages/libretto/skills/libretto/SKILL.md` — current agent guidance assumes `open` at the start; benchmark-local instructions must override that for Kernel mode.
- `https://kernel.sh/docs/browsers/create-a-browser` — official Kernel browser creation and CDP connection flow.
- `https://kernel.sh/docs/browsers/bot-detection/stealth` — stealth mode and auto-reCAPTCHA behavior.
- `https://kernel.sh/docs/browsers/bot-detection/overview` — Kernel’s guidance on bot-detection tradeoffs and the warning that CDP is still a detectable surface.
- `https://kernel.sh/docs/browsers/termination` — required explicit deletion and timeout behavior.
- `https://kernel.sh/docs/api-reference/browsers/create-a-browser-session` — request/response fields such as `session_id`, `cdp_ws_url`, `timeout_seconds`, and `stealth`.
- `https://kernel.sh/docs/browsers/viewport` — viewport defaults and supported values; useful if benchmark screenshots need a pinned viewport.
- `https://kernel.sh/docs/browsers/pools/overview` — optional future direction if startup latency or stable IP reuse becomes important.

## Implementation

### Phase 1: Add WebSocket CDP support to `libretto connect` and a benchmark-owned Kernel session bootstrap helper

Teach `libretto connect` to accept `ws://`/`wss://` CDP WebSocket URLs (Kernel returns these), then create a benchmark helper that provisions a Kernel browser and registers it via `libretto connect`.

#### `libretto connect` WebSocket support

`runConnect` in `packages/libretto/src/cli/core/browser.ts` previously only accepted HTTP(S) URLs and validated reachability by fetching `/json/version`. For WebSocket URLs the HTTP health check is skipped — the Playwright `connectOverCDP` call serves as validation instead. Port inference maps `wss:` → 443 and `ws:` → 80 when no explicit port is present.

#### Kernel session bootstrap

```ts
async function openKernelSessionForBenchmark(args: {
  runDir: string;
  sessionName: string;
  startUrl: string;
}): Promise<KernelSessionHandle> {
  const kernelBrowser = await kernel.browsers.create({
    stealth: true,
    headless: false,
    timeout_seconds: 7200,
  });
  await primeSessionAtUrl(kernelBrowser.cdp_ws_url, args.startUrl);
  // Uses `pnpm -s cli connect <wss://...> --session <name>` in the run workspace
  await connectLibrettoSession(args.runDir, args.sessionName, kernelBrowser.cdp_ws_url);
  return { ... };
}
```

- [x] Add `@onkernel/sdk` (`^0.44.0`) to `benchmarks/package.json`
- [x] Update `runConnect` in `packages/libretto/src/cli/core/browser.ts` to accept `ws://`/`wss://` CDP URLs by skipping the HTTP `/json/version` health check for WebSocket protocols and mapping `wss:` → port 443 / `ws:` → port 80
- [x] Create `benchmarks/webVoyager/kernel-session.ts` with:
  - `openKernelSessionForBenchmark(...)` — creates Kernel browser, primes at start URL, registers via `libretto connect`, writes `kernel-session.json` metadata
  - `closeKernelSessionForBenchmark(...)` — idempotent Kernel session deletion
  - `ensureKernelApiKey()` — resolves from `KERNEL_API_KEY` env var or GCP Secret Manager (`libretto-benchmarks-kernel-api-key`)
- [x] Prime the Kernel session by connecting over CDP and navigating the existing default page/context to the case start URL
- [x] Update `buildWebVoyagerPrompt` in `benchmarks/webVoyager/prompt.ts` to accept a `browserBackend` option; in Kernel mode the prompt tells the agent the session is already open, not to run `open`, and to start with `snapshot`
- [x] Success criteria: `pnpm type-check` passes, `pnpm --filter libretto test` passes

### Phase 2: Use the helper in local WebVoyager runs and pre-open the named Libretto session

Teach the benchmark runner to choose a browser backend and, in Kernel mode, create the browser before the agent starts. Update the benchmark-local instructions so the agent treats the session as already open and begins with `snapshot`/`exec` instead of `open`.

```ts
async function prepareBrowserBackend(args: {
  backend: "local" | "kernel";
  row: WebVoyagerRow;
  runDir: string;
  sessionName: string;
}) {
  if (args.backend === "kernel") {
    return await openKernelSessionForBenchmark({
      runDir: args.runDir,
      sessionName: args.sessionName,
      startUrl: args.row.web,
    });
  }

  return null;
}
```

- [ ] Add a benchmark backend selector in `benchmarks/webVoyager/commands.ts` and `runner.ts` (for example `--browser-backend local|kernel`, defaulting to `local`)
- [ ] In `runWebVoyagerCase`, when backend is `kernel`, call the new helper after workspace creation and before `createAgentSession(...)`
- [ ] Pass `browserBackend` to `buildWebVoyagerPrompt` (prompt changes already landed in Phase 1)
- [ ] Update benchmark-local `AGENTS.md` to add a Kernel-mode note when backend is `kernel`
- [ ] Keep the existing local behavior unchanged when backend is `local`
- [ ] Success criteria: `pnpm benchmarks webVoyager run --count 1 --browser-backend kernel` starts with a pre-opened Kernel-backed Libretto session, the agent transcript shows `snapshot`/`exec` use without a preceding `open`, and evaluator screenshots are still captured from the Kernel session

### Phase 3: Add runner-owned cleanup and Kernel debugging artifacts

Make benchmark cleanup reliable even if the agent never runs `npx libretto close`. This keeps Kernel costs bounded and makes failures debuggable by preserving the remote session metadata in the run directory.

```ts
let kernelSession: KernelSessionHandle | null = null;

try {
  kernelSession = await prepareBrowserBackend(...);
  await session.prompt(prompt);
} finally {
  if (kernelSession) {
    await closeKernelSessionForBenchmark(kernelSession);
  }
}
```

- [ ] Ensure `runWebVoyagerCase` always deletes the Kernel browser in a `finally` block when Kernel mode was used
- [ ] Write a small artifact into the run directory with `kernelSessionId`, `browserLiveViewUrl`, backend type, and selected Kernel options so failed runs are inspectable
- [ ] Include the chosen backend in `result.json` so local and GCP result bundles make the transport choice explicit
- [ ] Make cleanup idempotent so agent-issued `npx libretto close` only clears local state while runner cleanup still safely deletes the remote Kernel browser
- [ ] Success criteria: a forced failure mid-run still leaves a debuggable Kernel metadata artifact in the case directory and does not leave the remote browser running after the runner exits

### Phase 4: Thread Kernel mode through Cloud Run dispatch and task startup

Make GCP runs honor the same backend choice as local runs. The cloud path must propagate backend selection and fail fast when the Cloud Run job is missing Kernel credentials.

```ts
envOverrides: {
  BENCH_RUN_ID: runId,
  BENCH_SELECTION: JSON.stringify(selectionParams),
  BENCH_BROWSER_BACKEND: input.browserBackend,
}
```

- [ ] Add backend selection to `benchmarks/webVoyager/cloud-dispatch.ts`, `cloud-entrypoint.ts`, and any manifest/result metadata that should record it
- [ ] When backend is `kernel`, require `KERNEL_API_KEY` in the task environment and surface a clear startup error if it is missing
- [ ] Update the Cloud Run job setup/docs so Kernel-backed runs can be dispatched with the necessary secret/env configuration
- [ ] Preserve current local/GCP behavior for `--browser-backend local`
- [ ] Success criteria: `pnpm benchmarks webVoyager run --gcp --count 1 --browser-backend kernel` dispatches a run whose case task records `browserBackend: "kernel"`, and a misconfigured job without `KERNEL_API_KEY` fails before agent startup with an actionable message instead of silently falling back to local Playwright
