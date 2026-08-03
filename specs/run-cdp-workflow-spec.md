## Problem overview

`libretto run` can launch local Chromium or create a cloud provider browser, but it cannot execute a workflow against an already-running CDP endpoint (Chrome with `--remote-debugging-port`, Electron apps, CI browsers). Users must `connect` for interactive `exec`/`snapshot` only; there is no way to run a default-exported `workflow()` file on that external browser.

## Solution overview

Add `--cdp <url>` to `libretto run` as a third browser source alongside local launch and `--provider`. The command spawns a daemon with existing `browser.kind: "connect"` plus a workflow config, navigates to the workflow's required `startUrl`, then runs the handler. `connect` stays the interactive attach path; this spec does not add workflow attach to an already-open Libretto session.

## Goals

- `libretto run ./workflow.ts --cdp http://127.0.0.1:9222` connects over CDP, opens the workflow `startUrl`, and runs the default-exported workflow.
- Workflow `startUrl` remains required and is navigated before the handler, including on CDP runs.
- CDP runs never terminate the remote browser or Electron app on success, failure, or `close`.
- `--cdp` is mutually exclusive with `--provider` and with local-only launch flags that do not apply (`--headed`/`--headless`, `--viewport`).
- Optional `--page <id>` selects which existing CDP page receives navigation and the workflow `page` context.

## Non-goals

- No migrations or backfills.
- No `run --session` attach to a live Libretto daemon created by `open`/`connect` (separate feature).
- No `connect --run` flag or new top-level command.
- No change to `workflow()` requiring `startUrl`.
- No generalized workflow job queue; still one workflow invocation per daemon session.
- No Electron-specific launcher (user still starts the app with `--remote-debugging-port`).

## Important files/docs/websites for implementation

- `packages/libretto/src/cli/commands/execution.ts` — `run` CLI input, `createRunBrowserConfig`, `runIntegrationFromFile`; add `--cdp` / `--page` and wire connect browser config.
- `packages/libretto/src/cli/core/daemon/config.ts` — `DaemonBrowserConnectConfig` already exists (`kind: "connect"`, `cdpEndpoint`, `initialUrl`).
- `packages/libretto/src/cli/core/daemon/daemon.ts` — `connectToEndpoint` already navigates `initialUrl`; workflow bootstrap today only copies `startUrl` onto `launch`, not `connect`.
- `packages/libretto/src/cli/core/workflow-runner/runner.ts` — `WorkflowController` receives the daemon's chosen `page`.
- `packages/libretto/src/cli/core/browser.ts` — `runConnect` reference for CDP URL probing and externally-managed session semantics.
- `packages/libretto/test/basic.spec.ts` / `packages/libretto/test/daemon-ipc.spec.ts` — patterns for `run` and daemon-backed sessions.
- `docs/reference/cli/run-and-resume.mdx` — document `--cdp` and `--page`.
- `docs/reference/cli/open-and-connect.mdx` — cross-link: interactive `connect` vs scripted `run --cdp`.
- `packages/libretto/skills/libretto/SKILL.md` — agent guidance for Electron/CDP workflow runs (source of truth; then `pnpm sync:mirrors`).
- `.agents/skills/external-electron-apps/SKILL.md` — today ends at `exec`; add `run --cdp` for scripted workflows.

## Implementation

### Phase 1: Accept `--cdp` on `run` and spawn a connect+workflow daemon

Expose CDP as a browser source on `run` using the daemon's existing `kind: "connect"` config. Reject flag combinations that cannot apply to an external browser.

```ts
// packages/libretto/src/cli/commands/execution.ts
export function createRunBrowserConfig(args: {
  cdpEndpoint?: string;
  providerName?: string;
  headless: boolean;
  viewport?: { width: number; height: number };
  windowPosition?: WindowPositionConfig;
}): DaemonConfig["browser"] {
  if (args.cdpEndpoint) {
    return { kind: "connect", cdpEndpoint: args.cdpEndpoint };
  }
  if (args.providerName) {
    return {
      kind: "provider",
      providerName: args.providerName,
      headless: args.headless,
      ...(args.viewport ? { viewport: args.viewport } : {}),
    };
  }
  return {
    kind: "launch",
    headed: !args.headless,
    viewport: args.viewport ?? { width: 1366, height: 768 },
    ...(!args.headless && args.windowPosition
      ? { windowPosition: args.windowPosition }
      : {}),
  };
}
```

- [x] Add optional `--cdp` string option to `runInput` (CDP HTTP or WebSocket URL).
- [x] Refine: cannot pass `--cdp` with `--provider` / `-p`.
- [x] Refine: cannot pass `--cdp` with `--headed`, `--headless`, or `--viewport` (error must say those only apply when Libretto launches the browser; drop them or omit `--cdp`).
- [x] Pass `cdpEndpoint` through `runIntegrationFromFile` into `createRunBrowserConfig`.
- [x] When `--cdp` is set, mark the session as externally managed the same way `connect` does (disconnect on close; do not kill the remote process).
- [x] Update `run` usage/help text to include `--cdp`.
- [x] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 2: Apply workflow `startUrl` to CDP connect runs

Connect+workflow must navigate to `startUrl` before the handler, matching local and provider `run` behavior. Today only `launch` gets `initialUrl` from workflow metadata.

```ts
// packages/libretto/src/cli/core/daemon/config.ts
export function applyWorkflowStartUrlToBrowserConfig(
  browser: DaemonConfig["browser"],
  startUrl: string | undefined,
): DaemonConfig["browser"] {
  if (
    !startUrl ||
    (browser.kind !== "launch" && browser.kind !== "connect") ||
    browser.initialUrl
  ) {
    return browser;
  }
  return { ...browser, initialUrl: startUrl };
}
```

Daemon `main` calls this for non-provider browser configs after loading the workflow.

- [x] Extend the workflow `startUrl` → `initialUrl` merge to `kind: "connect"` (not only `launch`).
- [x] Keep requiring `startUrl` on the workflow; do not add a CDP exception that skips navigation.
- [x] Add a focused unit/integration assertion that a connect+workflow daemon config ends up with `initialUrl` equal to the workflow `startUrl`.
- [x] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 3: End-to-end `run --cdp` coverage

Prove the primary Electron/CDP path: external Chromium with remote debugging, `run --cdp`, navigation to `startUrl`, workflow completion, remote browser still alive after Libretto disconnects.

```ts
// packages/libretto/test/... (follow docs/tests-guide.md)
test("run --cdp executes workflow against an external CDP browser", async ({
  ...
}) => {
  // Launch Chromium with --remote-debugging-port (or reuse test helper).
  // libretto run ./wf.ts --cdp http://127.0.0.1:<port> --session run-cdp
  // Assert workflow output / success.
  // Assert remote browser process still running after run completes.
  // Assert Libretto session is closed (unless --stay-open-on-success).
});
```

- [ ] Add an integration test that starts a CDP-enabled Chromium, runs a small workflow with `startUrl` via `run --cdp`, and asserts success.
- [ ] Assert the workflow landed on `startUrl` (handler checks `page.url()` or equivalent).
- [ ] Assert a normal successful CDP run disconnects the Libretto session without killing the CDP browser process.
- [ ] Assert `--stay-open-on-success` leaves a daemon-backed session usable with `pages` / `snapshot` against the same CDP browser.
- [ ] Assert conflicting flags (`--cdp` + `--provider`, `--cdp` + `--headless`) fail with actionable errors.
- [ ] Run the new tests with the project's existing test command for this package.

### Phase 4: Optional `--page` for multi-target CDP browsers

Electron and multi-window Chrome often expose several pages. Let `run --cdp` select which page gets `startUrl` navigation and becomes `ctx.page`.

```ts
// packages/libretto/src/cli/core/daemon/daemon.ts
// Before navigateUrl / startWorkflow, when pageId is provided:
const targetPage = daemon.resolveTargetPage(pageId);
// use targetPage for goto(startUrl) and WorkflowController page
```

- [ ] Add optional `--page` to `run` (same id form as `exec` / `snapshot`).
- [ ] Plumb `pageId` through daemon workflow start so navigation and `WorkflowController` use that page.
- [ ] On unknown page id, fail with the same next-step style as `exec` (`libretto pages --session ...`).
- [ ] When `--page` is omitted, keep current connect default (last operational page, or create one).
- [ ] Add a test with two pages on one CDP browser: `run --cdp --page <id>` targets the chosen page.
- [ ] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 5: Docs and skill guidance

Document the scripted CDP path without changing the interactive `connect` story.

- [ ] Update `docs/reference/cli/run-and-resume.mdx` with `--cdp`, `--page`, lifecycle notes, and an Electron/CDP example.
- [ ] Update `docs/reference/cli/open-and-connect.mdx` to point scripted workflow execution at `run --cdp`.
- [ ] Update `packages/libretto/skills/libretto/SKILL.md` run-modes / commands: use `run --cdp` for workflows on external CDP; keep `connect` for explore/`exec`.
- [ ] Update `.agents/skills/external-electron-apps/SKILL.md` with a `run --cdp` example after interactive discovery.
- [ ] Run `pnpm sync:mirrors` if skill mirrors need regeneration; run `pnpm check:mirrors`.
