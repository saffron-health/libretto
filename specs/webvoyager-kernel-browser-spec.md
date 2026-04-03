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
- [x] Update `buildWebVoyagerPrompt` in `benchmarks/webVoyager/prompt.ts` to always generate a Kernel-mode prompt that tells the agent the session is already open, not to run `open`, and to start with `snapshot` (the `browserBackend` option was removed in Phase 2 when local support was dropped)
- [x] Success criteria: `pnpm type-check` passes, `pnpm --filter libretto test` passes

### Phase 2: Always use Kernel in WebVoyager runs with runner-owned cleanup

Removed the local browser backend entirely — all WebVoyager benchmark runs now use Kernel-backed stealth browsers. The runner opens a Kernel session before the agent starts and cleans it up in a `finally` block.

- [x] Removed `--browser-backend` CLI option and `BrowserBackend` type — Kernel is the only backend
- [x] `runWebVoyagerCase` always calls `openKernelSessionForBenchmark` after workspace creation and before `createAgentSession`
- [x] `buildWebVoyagerPrompt` always generates the Kernel prompt (session pre-opened, start with `snapshot`)
- [x] Benchmark workspace `AGENTS.md` always includes Kernel browser mode instructions
- [x] Runner always cleans up the Kernel session in a `finally` block via `closeKernelSessionForBenchmark`
- [x] Kernel metadata artifact (`kernel-session.json`) is written by `openKernelSessionForBenchmark` (landed in Phase 1)
- [x] Success criteria: `pnpm type-check` passes, `pnpm --filter libretto test` passes
- [ ] Success criteria: `pnpm benchmarks webVoyager run --count 1` starts with a pre-opened Kernel-backed Libretto session, the agent transcript shows `snapshot`/`exec` use without a preceding `open`, and evaluator screenshots are still captured from the Kernel session

### Phase 3: Thread Kernel mode through Cloud Run dispatch and task startup

Make GCP runs work with the Kernel-only backend. The cloud path must propagate `KERNEL_API_KEY` and fail fast when the Cloud Run job is missing credentials.

- [x] Ensure `KERNEL_API_KEY` is available in the Cloud Run task environment (via `ensureKernelApiKey` which already falls back to GCP Secret Manager)
- [x] Update the Cloud Run job setup/docs so dispatched runs have the necessary secret/env configuration
- [x] Include `browserBackend: "kernel"` in `result.json` and manifest metadata so result bundles are explicit
- [x] Success criteria: `pnpm benchmarks webVoyager run --gcp --count 1` dispatches a run whose case task uses Kernel, and a misconfigured job without `KERNEL_API_KEY` or GCP secret access fails before agent startup with an actionable message
