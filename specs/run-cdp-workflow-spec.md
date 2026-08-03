## Problem overview

`libretto run` can launch local Chromium or create a cloud provider browser, but it cannot execute a workflow against an already-running CDP endpoint (Chrome with `--remote-debugging-port`, Electron apps, CI browsers). Users must `connect` for interactive `exec`/`snapshot` only; there is no way to run a default-exported `workflow()` file on that external browser.

## Solution overview

Add `--cdp <url>` to `libretto run` as a third browser source alongside local launch and `--provider`. The command spawns a daemon with existing `browser.kind: "connect"` plus a workflow config, attaches to the selected page without navigating to `startUrl`, then runs the handler. `connect` stays the interactive attach path; this spec does not add workflow attach to an already-open Libretto session.

## Goals

- `libretto run ./workflow.ts --cdp http://127.0.0.1:9222` connects over CDP, attaches to the existing page without changing its URL, and runs the default-exported workflow.
- Workflow `startUrl` remains declared for launch/provider runs; `run --cdp` does not navigate to it so existing page URL and auth state stay intact.
- CDP runs never terminate the remote browser or Electron app on success, failure, or `close`.
- `--cdp` is mutually exclusive with `--provider` and with local-only launch flags that do not apply (`--headed`/`--headless`, `--viewport`).
- Optional `--page <id>` selects which existing CDP page becomes the workflow `page` context.

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

### Phase 2: Do not apply workflow `startUrl` to CDP connect runs

Launch and provider `run` still open `startUrl` before the handler. Connect/CDP workflow runs must attach without navigation so the existing page URL and authentication state remain intact. Automatic CDP navigation discarded useful state and could hit Libretto's navigation timeout before the handler began.

```ts
// packages/libretto/src/cli/core/daemon/config.ts
export function applyWorkflowStartUrlToBrowserConfig(
  browser: DaemonConfig["browser"],
  startUrl: string | undefined,
): DaemonConfig["browser"] {
  if (!startUrl || browser.kind !== "launch" || browser.initialUrl) {
    return browser;
  }
  return { ...browser, initialUrl: startUrl };
}
```

Daemon `main` calls this for non-provider browser configs after loading the workflow.

- [x] Apply workflow `startUrl` → `initialUrl` only for `kind: "launch"` (not `connect`).
- [x] Keep requiring/declaring `startUrl` on workflows for launch and provider runs; CDP attach skips navigation.
- [x] Add a focused unit assertion that a connect+workflow daemon config does not gain `initialUrl` from workflow `startUrl`.
- [x] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 3: End-to-end `run --cdp` coverage

Prove the primary Electron/CDP path: external Chromium with remote debugging, `run --cdp`, attach without `startUrl` navigation, workflow completion, remote browser still alive after Libretto disconnects.

Tests live in `packages/libretto/test/run-cdp.spec.ts`. They start a CDP-capable browser via `libretto open --headless`, then point `run --cdp` at that port (same pattern as connect E2E). Flag-conflict coverage for `--cdp` + `--provider` / `--headless` is in `packages/libretto/test/basic.spec.ts`. Launch-mode `startUrl` navigation stays covered in the same file.

```ts
// packages/libretto/test/run-cdp.spec.ts
test("attaches without navigating away from the existing page", async ({
  librettoCli,
  writeWorkflow,
  workspacePath,
}) => {
  await librettoCli(`open data:text/html,... --headless --session ${sourceSession}`);
  // read CDP port from source session state
  await librettoCli(
    `run "${integrationFilePath}" --cdp http://127.0.0.1:${port} --session ${runSession}`,
  );
  // assert existing page preserved + source browser still alive
});
```

- [x] Add an integration test that starts a CDP-enabled Chromium, runs a small workflow with `startUrl` via `run --cdp`, and asserts success without navigating to `startUrl`.
- [x] Assert the workflow stays on the pre-existing page (handler checks `page.url()` / title / body).
- [x] Assert launch-mode `run` still navigates to workflow `startUrl`.
- [x] Assert a normal successful CDP run disconnects the Libretto session without killing the CDP browser process.
- [x] Assert `--stay-open-on-success` leaves a daemon-backed session usable with `pages` / `snapshot` against the same CDP browser.
- [x] Assert conflicting flags (`--cdp` + `--provider`, `--cdp` + `--headless`) fail with actionable errors.
- [x] Run the new tests with the project's existing test command for this package.

### Phase 4: Optional `--page` for multi-target CDP browsers

Electron and multi-window Chrome often expose several pages. Let `run --cdp` select which page becomes `ctx.page` (without navigating away from that page's current URL).

Initial pages discovered at daemon start are tracked as stable `page-0` .. `page-N` ids (later popups still get random ids). `run --cdp --page page-1` selects by that index among pages found at connect time, so the id matches what `pages` shows on another CDP session attached to the same browser.

```ts
// packages/libretto/src/cli/core/daemon/config.ts
export type DaemonBrowserConnectConfig = {
  kind: "connect";
  cdpEndpoint: string;
  initialUrl?: string;
  pageId?: string;
};

// packages/libretto/src/cli/core/daemon/daemon.ts
if (config.pageId) {
  const pageIndex = parseConnectPageIndex(config.pageId);
  // select operationalPages[pageIndex] before initialize (no startUrl navigation)
}
```

- [x] Add optional `--page` to `run` (same id form as `exec` / `snapshot`).
- [x] Plumb `pageId` through daemon workflow start so `WorkflowController` uses that page.
- [x] On unknown page id, fail with the same next-step style as `exec` (`libretto pages --session ...`).
- [x] When `--page` is omitted, keep current connect default (last operational page, or create one).
- [x] Add a test with two pages on one CDP browser: `run --cdp --page <id>` targets the chosen page without navigating.
- [x] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 5: Docs and skill guidance

Document the scripted CDP path without changing the interactive `connect` story. Document that `run --cdp` does not navigate to workflow `startUrl`.

- [x] Update `docs/reference/cli/run-and-resume.mdx` with `--cdp`, `--page`, lifecycle notes, and an Electron/CDP example.
- [x] Update `docs/reference/cli/open-and-connect.mdx` to point scripted workflow execution at `run --cdp`.
- [x] Update `packages/libretto/skills/libretto/SKILL.md` run-modes / commands: use `run --cdp` for workflows on external CDP; keep `connect` for explore/`exec`.
- [x] Update `.agents/skills/external-electron-apps/SKILL.md` with a `run --cdp` example after interactive discovery.
- [x] Run `pnpm sync:mirrors` if skill mirrors need regeneration; run `pnpm check:mirrors`.
