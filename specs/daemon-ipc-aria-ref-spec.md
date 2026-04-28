# Persistent browser daemon IPC for aria-ref support

## Problem overview

Every `libretto snapshot` / `libretto exec` call creates a fresh Playwright CDP connection (`chromium.connectOverCDP`), runs its operation, and disconnects. Playwright's `aria-ref` selector engine depends on a ref→element map (`_lastAriaSnapshotForQuery`) that lives in the `InjectedScript` on the persistent `Page` object. This map is destroyed on disconnect, so `[ref=eN]` selectors from a snapshot call are invalid by the time exec runs.

This was confirmed empirically: in the Playwright AI barbershop benchmark, `page.locator("[ref=e78]").click()` times out after 15s because refs don't survive across CDP connections.

## Solution overview

Route `snapshot`, `exec`, `readonly-exec`, and `pages` commands through the browser daemon via a Unix domain socket IPC channel. The daemon already holds a persistent `Page` object; adding an IPC server lets CLI commands operate on that same Page, preserving the aria-ref map across calls. The daemon is the implementation for these commands — the existing client-side CDP connect/disconnect code for `exec`, `snapshot`, `pages`, and `readonly-exec` is replaced, not wrapped in a fallback. Sessions created via `libretto connect` (no daemon) retain their own direct CDP path since they have no daemon process.

## Goals

- `exec` can use `[ref=eN]` selectors from a preceding `snapshot` call within the same daemon session.
- `libretto snapshot`, `exec`, `readonly-exec`, and `pages` work identically from the user's perspective.
- The daemon is the implementation for `open`-based sessions. The existing client-side CDP connect/disconnect code in `browser.ts` and `execution.ts` is moved to the daemon — not kept as a fallback.
- Sessions created via `libretto connect` retain their own direct CDP path (they have no daemon process).

## Non-goals

- No migrations or backfills.
- No changes to the `run` command or its worker process (it manages its own browser lifecycle).
- No changes to `connect`-based sessions (they don't use the local daemon).
- No remote/network-accessible IPC — Unix socket is local-only.
- No multi-command streaming, cancellation, or advanced RPC — one request per connection.

## Future work

- **`run` command integration.** The `run` worker could optionally connect to a daemon instead of launching its own browser, enabling post-run inspection of the same Page.
- **Daemon monitors all pages closing.** `browser.on('disconnected')` fires when Chromium dies, but not when the user closes the last tab. Detecting "all pages closed" would require CDP target events.
- **Remote IPC.** If non-local clients are needed, upgrade from UDS+NDJSON to HTTP over UDS or a small RPC framework.

## Important files/docs for implementation

- `packages/libretto/src/cli/core/daemon-protocol.ts` — Phase 1 output: protocol types (`DaemonRequest`, `DaemonResponse`) and `getDaemonSocketPath()`. Will be renamed to `daemon-ipc.ts` and extended with `DaemonServer` and `DaemonClient` classes.
- `packages/libretto/src/cli/core/browser-daemon.ts` — Existing daemon process to extend with `DaemonServer`.
- `packages/libretto/src/cli/core/browser.ts` — `connect()`, `disconnectBrowser()`, `resolvePageReferences()`, `resolveOperationalPages()`, `listOpenPages()`, `runPages()`. Operations to route through `DaemonClient`.
- `packages/libretto/src/cli/commands/snapshot.ts` — Snapshot command: screenshot + HTML + condenseDom + AI analysis. Playwright capture moves to daemon; AI stays in CLI.
- `packages/libretto/src/cli/commands/execution.ts` — `exec`, `readonly-exec` commands with `compileExecFunction`, helper injection, action logging.
- `packages/libretto/src/cli/core/context.ts` — Session directory paths.
- `packages/libretto/src/shared/state/session-state.ts` — `SessionStateFileSchema` (already extended with `daemonSocketPath` in Phase 1).
- `packages/libretto/src/cli/core/session.ts` — Session state read/write/validation.
- `packages/libretto/src/cli/core/readonly-exec.ts` — `createReadonlyExecHelpers()` for read-only page proxy.
- `packages/libretto/src/cli/core/telemetry.ts` — `wrapPageForActionLogging()`, `readActionLog()`, `readNetworkLog()`.
- `packages/libretto/src/shared/instrumentation/instrument.ts` — `installInstrumentation()` for ghost cursor/highlight visualization.
- `packages/libretto/src/cli/core/api-snapshot-analyzer.ts` — `runApiInterpret()`. Reads files from disk, unchanged.
- `packages/libretto/src/shared/condense-dom/condense-dom.ts` — `condenseDom()`. Stays in CLI process.
- `packages/libretto/skills/libretto/SKILL.md` — Agent skill documentation. Update ref selector guidance.
- `packages/libretto/test/daemon-ipc.spec.ts` — Phase 1 output: integration tests (currently failing) that define expected daemon IPC behavior.
- `packages/libretto/test/fixtures.ts` — Test harness with `librettoCli`, `seedSessionState`, etc.
- Notion task: https://www.notion.so/350ac9fb35f18102a2f7de46be3abe49

## Implementation

### Phase 1: Protocol types, socket path infrastructure, and integration tests ✅

Protocol types (`DaemonRequest`, `DaemonResponse`), `getDaemonSocketPath()`, `daemonSocketPath` added to session state schema, and integration tests written in `test/daemon-ipc.spec.ts`. Tests are failing — they define the contract for Phases 2–5.

**Committed:** `770cc0a`

**Files created/modified:**

- `packages/libretto/src/cli/core/daemon-protocol.ts` (new)
- `packages/libretto/src/shared/state/session-state.ts` (added `daemonSocketPath` field)
- `packages/libretto/test/daemon-ipc.spec.ts` (new — 4 failing tests)

### Phase 2: DaemonServer, DaemonClient, ping, open/close wiring, and daemon refactor ✅

Renamed `daemon-protocol.ts` to `daemon-ipc.ts` and added `DaemonServer` and `DaemonClient` classes alongside the existing types. Started the IPC server in the daemon with a `ping` handler, wired `runOpen()` to write `daemonSocketPath` and verify IPC, and cleaned up the socket on close. Refactored `browser-daemon.ts` from procedural top-level code into a `BrowserDaemon` class.

**Files modified:**

- `packages/libretto/src/cli/core/daemon-protocol.ts` → `daemon-ipc.ts` (renamed, added `DaemonServer` and `DaemonClient` classes)
- `packages/libretto/src/cli/core/browser-daemon.ts` (refactored to `BrowserDaemon` class, IPC server with `ping` handler)
- `packages/libretto/src/cli/core/browser.ts` (`runOpen` writes `daemonSocketPath` + IPC ping verification, `runClose` unlinks socket)

**`daemon-ipc.ts` — IPC infrastructure:**

```ts
export type RequestHandler = (request: DaemonRequest) => Promise<unknown>;

export class DaemonServer {
  constructor(socketPath: string, handler: RequestHandler) { ... }
  async listen(): Promise<void> { ... }   // unlinks stale socket, starts listening
  async close(): Promise<void> { ... }    // closes server, unlinks socket
}

export class DaemonClient {
  constructor(socketPath: string) { ... }
  async send(request: DaemonRequest): Promise<DaemonResponse> { ... }
  async ping(): Promise<boolean> { ... }  // convenience: send ping, return true/false
}
```

**`browser-daemon.ts` — `BrowserDaemon` class:**

Refactored from procedural top-level script into a class with a static factory method:

- `static async create(config)`: all async setup (browser launch, context/page creation, telemetry, IPC server, navigation) happens here. Private constructor receives fully-initialized values.
- `shutdown(reason, closeBrowser)`: idempotent — `DaemonServer.close()` nulls server, `unlink` tolerates ENOENT, no `shuttingDown` flag needed.
- `handleRequest(request)`: dispatches on `request.command`. Currently only `ping` (returns `{ protocolVersion: 1 }`).
- No explicit keepalive mechanism — the process stays alive via active handles (`net.Server` + browser connection). `shutdown()` closes both, letting the process exit naturally.
- Daemon does NOT manage session state cleanup — that's the CLI client's responsibility (`runClose()` in `browser.ts` calls `clearSessionState()`).

**`browser.ts` — open/close wiring:**

- `runOpen()`: computes `daemonSocketPath` via `getDaemonSocketPath`, includes it in `writeSessionState()`. After writing state, polls `DaemonClient.ping()` (up to 20 attempts × 250ms) to verify IPC is reachable. Removed the previous hardcoded 2s sleep — the IPC ping loop provides the necessary wait.
- `runClose()`: unlinks `state.daemonSocketPath` if present before clearing session state.

**Test results:** 3 of 4 daemon IPC tests pass (they work via the existing CDP connect/disconnect path). The `exec persists state across calls` test fails — expected, since state persistence requires routing `exec` through the daemon (Phase 3).

### Phase 3: Route pages, exec, and readonly-exec through daemon ✅

Add `pages`, `exec`, and `readonly-exec` handlers to the daemon, and wire the CLI commands to use `DaemonClient` when `daemonSocketPath` is present. This is the core phase that enables aria-ref selectors to work across snapshot→exec calls.

**Files created/modified:**

- `packages/libretto/src/cli/core/exec-compiler.ts` (new — shared `compileExecFunction`, `compileTypeScriptExecFunction`, `withSuppressedStripTypeScriptWarning`, `stripEmptyCatchHandlers`, extracted from `execution.ts`)
- `packages/libretto/src/cli/core/daemon-ipc.ts` (added `DaemonResultMap` response type map; `DaemonClient.send` made private; added typed convenience methods `pages()`, `exec()`, `readonlyExec()` via generic `sendOrThrow`)
- `packages/libretto/src/cli/core/browser-daemon.ts` (promoted `context`/`page` to instance fields; added `pages`, `exec`, `readonly-exec` handlers with 60s timeout; `execState` persists across calls; daemon-owned page IDs; action logging installed once in `create()` + `context.on("page")` for dynamic pages)
- `packages/libretto/src/cli/commands/execution.ts` (imports compiler from `exec-compiler.ts`; split `runExec` into `runExecViaDaemon`/`runExecViaConnect` with daemon routing when `daemonSocketPath` present; removed redundant Node.js globals from connect-based helpers)
- `packages/libretto/src/cli/core/browser.ts` (`runPages` routes through `DaemonClient` when `daemonSocketPath` present)

**Daemon-owned page IDs:**

The daemon assigns its own page IDs (`page-<3 random alphanumeric chars>`) via a `Map<string, Page>`. Pages are registered when created (initial page in `create()`, dynamic pages via `context.on("page")`), and unregistered on close. `resolveTargetPage(pageId?)` is synchronous — just a map lookup, no CDP sessions. The `pages` command must route through the daemon for `open`-based sessions so users see the same IDs that `exec --page <id>` expects. `connect`-based sessions continue using CDP target IDs via `listOpenPages()`.

**Typed `DaemonClient` interface:**

`DaemonClient.send` is private. All commands go through typed convenience methods that auto-generate request IDs, send via `sendOrThrow`, and return typed results. Error responses throw automatically — no manual `response.type === "error"` checks at call sites.

```ts
export type DaemonResultMap = {
  ping: { protocolVersion: number };
  pages: Array<{ id: string; url: string; active: boolean }>;
  exec: { result: unknown };
  "readonly-exec": { result: unknown };
  snapshot: { pngPath: string; htmlPath: string; snapshotRunId: string; pageUrl: string; title: string };
};

export class DaemonClient {
  private async send(request: DaemonRequest): Promise<DaemonResponse> { ... }
  private async sendOrThrow<C extends DaemonRequest["command"]>(
    request: DaemonRequest & { command: C },
  ): Promise<DaemonResultMap[C]> { ... }

  async ping(): Promise<boolean> { ... }
  async pages(): Promise<DaemonResultMap["pages"]> { ... }
  async exec(args: { code: string; pageId?: string; visualize?: boolean }): Promise<DaemonResultMap["exec"]> { ... }
  async readonlyExec(args: { code: string; pageId?: string }): Promise<DaemonResultMap["readonly-exec"]> { ... }
}
```

**Exec helper injection:**

Only `page`, `context`, `browser`, `state`, `networkLog`, `actionLog` are injected. Standard Node.js globals (`console`, `setTimeout`, `fetch`, `URL`, `Buffer`, etc.) are naturally available in the `AsyncFunction` scope — not injected.

**Action logging:**

Installed once in `create()` on the initial page, plus `context.on("page", ...)` for dynamically opened pages. No per-request wrapping or idempotency flag needed.

**Checklist:**

- [x] Move `compileExecFunction`, `stripEmptyCatchHandlers`, and related helpers to `exec-compiler.ts`.
- [x] Implement `pages` handler — iterates daemon's `pageById` map, filters devtools/error pages.
- [x] Route `runPages()` through daemon when `daemonSocketPath` present.
- [x] Implement `exec` handler with persistent `execState`, `requireSinglePage` validation, instrumentation.
- [x] Implement `readonly-exec` handler using `createReadonlyExecHelpers()`.
- [x] Add per-request timeout (60s default) so a bad exec doesn't wedge the daemon.
- [x] Update `exec` and `readonly-exec` in `execution.ts`: daemon path when `daemonSocketPath` present, connect path otherwise.
- [x] Remove redundant Node.js globals from connect-based helper injection.
- [x] Add typed `DaemonClient` methods (`pages`, `exec`, `readonlyExec`) with `DaemonResultMap` and `sendOrThrow`.
- [x] `pnpm --filter libretto type-check` — passes.
- [x] All 4 daemon IPC tests pass. Full suite: 199 passed, 0 failed.

### Phase 4: Route snapshot through daemon

Move the Playwright capture (screenshot + `page.content()` + viewport normalization) into the daemon. The daemon writes artifact files to the session snapshot directory and returns their paths. The CLI continues to run `condenseDom` and AI analysis locally.

```ts
// Daemon snapshot handler:
case "snapshot": {
  const snapshotRunId = `snapshot-${Date.now()}`;
  const dir = getSessionSnapshotRunDir(session, snapshotRunId);
  mkdirSync(dir, { recursive: true });
  // viewport normalization + zero-width retry — same logic as captureScreenshot
  await targetPage.screenshot({ path: pngPath });
  const html = await targetPage.content();
  writeFileSync(htmlPath, html);
  return { pngPath, htmlPath, snapshotRunId, pageUrl: targetPage.url(), title: await targetPage.title() };
}

// CLI snapshot command — daemon path:
const client = new DaemonClient(state.daemonSocketPath);
const { pngPath, htmlPath, ... } = await client.snapshot({ pageId });
// CLI reads htmlPath, runs condenseDom, writes condensedHtmlPath, then calls runApiInterpret
```

- [ ] Add `snapshot` typed method to `DaemonClient`.
- [ ] Implement `snapshot` handler in `BrowserDaemon.dispatchCommand` that performs viewport normalization, screenshot, and `page.content()` capture. Write artifacts to the session snapshot directory. Return `{ pngPath, htmlPath, snapshotRunId, pageUrl, title }`.
- [ ] Port the viewport normalization and zero-width screenshot retry logic from `captureScreenshot()` into the daemon handler.
- [ ] Update the `snapshot` command in `snapshot.ts`: when `state.daemonSocketPath` is present, use `DaemonClient`. CLI reads `htmlPath`, runs `condenseDom`, writes `condensedHtmlPath`, then calls `runApiInterpret` as before. For `connect`-based sessions (no `daemonSocketPath`), use the existing `captureScreenshot()` path.
- [ ] Run `pnpm --filter libretto type-check` — passes.
- [ ] Add test to `test/daemon-ipc.spec.ts`: open headless → snapshot (without AI — use cleared API credentials) → verify stderr contains `Failed to analyze snapshot` (confirming the daemon captured the screenshot and the CLI reached the AI step). Alternatively, verify the snapshot PNG and HTML files exist on disk.

### Phase 5: Remove connect fallback for daemon-backed sessions

After all commands are routed through the daemon (Phases 3–4), remove the CDP connect/disconnect fallback from `open`-based sessions. The daemon is the exclusive implementation — if the daemon is unreachable, the command fails instead of silently falling back to a fresh CDP connection (which would lose aria-refs and state).

Currently, each command checks `state.daemonSocketPath` and branches: daemon path vs connect path. The connect path (`connect()` + `disconnectBrowser()` in `browser.ts`) is still reachable for `open`-based sessions in theory, since `daemonSocketPath` is the only gate. This phase removes the connect path for daemon-backed sessions entirely, so `connect()`/`disconnectBrowser()` are only used by `connect`-based sessions.

Concrete steps:

- [ ] Remove `runExecViaConnect` from `execution.ts`. Replace `runExec` branching with: `if (!state.daemonSocketPath) throw new Error("...")` for `open` sessions, or route `connect`-based sessions through a separate `connect`-only path.
- [ ] Remove the `listOpenPages` fallback from `runPages`. Daemon-backed sessions use `client.pages()`; connect-based sessions use `listOpenPages`.
- [ ] Remove the `captureScreenshot` fallback from `snapshot.ts`. Same pattern.
- [ ] Audit all remaining `connect()` / `disconnectBrowser()` imports in command files. They should only be reachable for `connect`-based sessions (`save` command, etc.).
- [ ] Run `pnpm --filter libretto test` — all tests pass. Daemon IPC tests verify the daemon path; connect-based tests (if any) verify the connect path. No test relies on an `open` session falling back to CDP connect.
- [ ] Run `pnpm --filter libretto type-check` — passes.

### Phase 6: SKILL.md update and full verification

Update skill documentation to reflect that `[ref=eN]` selectors now work when using daemon-backed sessions, and clarify limitations for non-daemon sessions. Run the full test suite.

- [ ] In `packages/libretto/skills/libretto/SKILL.md`, update the `exec` section: note that `[ref=eN]` aria-ref labels from `snapshot` output can be used as Playwright selectors in `exec` within the same session opened via `libretto open`. For sessions created via `libretto connect`, refs do not persist across calls — use semantic selectors instead.
- [ ] Run `pnpm sync:mirrors` to propagate to `.agents/skills/` and `.claude/skills/`.
- [ ] Run `pnpm check:mirrors` — passes with no drift.
- [ ] Run the full test suite: `pnpm --filter libretto test` — all existing tests plus all new daemon IPC tests pass.
- [ ] Run `pnpm --filter libretto type-check` — passes.
