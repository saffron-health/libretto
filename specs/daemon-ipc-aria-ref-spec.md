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

### Phase 2: DaemonServer, DaemonClient, ping, and open/close wiring

Rename `daemon-protocol.ts` to `daemon-ipc.ts` and add `DaemonServer` and `DaemonClient` classes alongside the existing types. Start the IPC server in the daemon with a `ping` handler, wire `runOpen()` to write `daemonSocketPath` and verify IPC, and clean up the socket on close. Command handlers (`pages`, `exec`, `snapshot`, etc.) are added in later phases.

```ts
// packages/libretto/src/cli/core/daemon-ipc.ts
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

- [ ] Rename `packages/libretto/src/cli/core/daemon-protocol.ts` to `daemon-ipc.ts`. Update all imports (`test/daemon-ipc.spec.ts` does not import it directly, so only internal references need updating).
- [ ] Add `DaemonServer` class. Constructor takes `socketPath` and `handler: RequestHandler`. `listen()` unlinks any stale socket, creates a `net.createServer` that accepts one NDJSON request per connection, calls the handler, writes one NDJSON response, and closes the connection. `close()` closes the server and unlinks the socket.
- [ ] Add `DaemonClient` class. Constructor takes `socketPath`. `send(request)` opens a connection, writes NDJSON, reads one NDJSON response line, closes, and returns the parsed `DaemonResponse`. `ping()` sends a ping request and returns `true` on success, `false` on connection error.
- [ ] In `packages/libretto/src/cli/core/browser-daemon.ts`, instantiate `DaemonServer` after page creation with a `RequestHandler` that dispatches on `request.command`. Implement `ping` (returns `{ protocolVersion: 1 }`). Call `server.close()` in the existing `shutdown()` function.
- [ ] Update `runOpen()` in `browser.ts`: compute `daemonSocketPath` via `getDaemonSocketPath`, include it when writing session state, and use `new DaemonClient(socketPath).ping()` to verify IPC is reachable before returning.
- [ ] Update `runClose()` in `browser.ts`: unlink the daemon socket file from `state.daemonSocketPath` during close.
- [ ] Run `pnpm --filter libretto type-check` — passes.
- [ ] All 4 daemon IPC tests still fail (expected — command handlers not yet implemented).

### Phase 3: Route pages, exec, and readonly-exec through daemon

Add `pages`, `exec`, and `readonly-exec` handlers to the daemon, and wire the CLI commands to use `DaemonClient` when `daemonSocketPath` is present. This is the core phase that enables aria-ref selectors to work across snapshot→exec calls.

Only `page`, `context`, `browser`, and `state` (plus `networkLog` and `actionLog`) need to be injected as helpers. Standard Node.js globals (`console`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `fetch`, `URL`, `Buffer`) are naturally available in the `AsyncFunction` scope and do not need explicit injection.

```ts
// Daemon exec handler (inside the RequestHandler):
case "exec":
case "readonly-exec": {
  const { cleaned } = stripEmptyCatchHandlers(request.code);
  if (request.command === "exec" && request.visualize)
    await installInstrumentation(targetPage, { visualize: true });
  const helpers = request.command === "readonly-exec"
    ? createReadonlyExecHelpers(targetPage)
    : { page: targetPage, context, browser, state: execState, networkLog, actionLog };
  const fn = compileExecFunction(cleaned, Object.keys(helpers));
  const result = await fn(...Object.values(helpers));
  return { result };
}
```

- [ ] Move `compileExecFunction`, `stripEmptyCatchHandlers`, and related helpers (`compileTypeScriptExecFunction`, `withSuppressedStripTypeScriptWarning`) to a shared module (e.g. `packages/libretto/src/cli/core/exec-compiler.ts`) importable by both the daemon and the `connect`-based session path.
- [ ] Implement `pages` handler in the daemon's `RequestHandler`. Enumerate operational pages with IDs — reuse `resolveOperationalPages`/`resolvePageReferences` logic extracted from `browser.ts`.
- [ ] Update `runPages()` in `browser.ts`: when `state.daemonSocketPath` is present, use `DaemonClient` to send a `pages` request. For `connect`-based sessions (no `daemonSocketPath`), use the existing direct CDP path.
- [ ] Implement `exec` handler in the daemon's `RequestHandler`. Inject only the non-global helpers: `page`, `context`, `browser`, `state`, `networkLog`, `actionLog`. Standard Node.js globals (`console`, `setTimeout`, `fetch`, `URL`, `Buffer`, etc.) are available naturally via `AsyncFunction` scope — do not inject them.
- [ ] The daemon's `execState` persists across calls — state set in one exec is available in the next.
- [ ] Implement `readonly-exec` handler using `createReadonlyExecHelpers()`.
- [ ] Add per-request timeout (60s default) so a bad exec doesn't wedge the daemon. On timeout, respond with an error.
- [ ] `wrapPageForActionLogging()` must be idempotent — guard against double-wrapping since the Page persists across requests.
- [ ] Update `exec` and `readonly-exec` commands in `execution.ts`: when `state.daemonSocketPath` is present, use `DaemonClient` to send the request. For `connect`-based sessions (no `daemonSocketPath`), use the existing direct CDP path.
- [ ] Also update the `connect`-based path's helper injection to match: only inject `page`, `context`, `browser`, `state`, `networkLog`, `actionLog`. Remove the redundant Node.js globals from the helpers object.
- [ ] Run `pnpm --filter libretto type-check` — passes.
- [ ] Tests now passing: all 4 daemon IPC tests (`pages`, `exec` value return, `exec` state persistence, `readonly-exec`).

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
const resp = await client.send({ id, command: "snapshot", pageId });
// resp.data has { pngPath, htmlPath, ... }
// CLI reads htmlPath, runs condenseDom, writes condensedHtmlPath, then calls runApiInterpret
```

- [ ] Implement `snapshot` handler in the daemon's `RequestHandler` that performs viewport normalization, screenshot, and `page.content()` capture. Write artifacts to the session snapshot directory. Return `{ pngPath, htmlPath, snapshotRunId, pageUrl, title }`.
- [ ] Port the viewport normalization and zero-width screenshot retry logic from `captureScreenshot()` into the daemon handler.
- [ ] Update the `snapshot` command in `snapshot.ts`: when `state.daemonSocketPath` is present, use `DaemonClient`. CLI reads `htmlPath`, runs `condenseDom`, writes `condensedHtmlPath`, then calls `runApiInterpret` as before. For `connect`-based sessions (no `daemonSocketPath`), use the existing `captureScreenshot()` path.
- [ ] Run `pnpm --filter libretto type-check` — passes.
- [ ] Add test to `test/daemon-ipc.spec.ts`: open headless → snapshot (without AI — use cleared API credentials) → verify stderr contains `Failed to analyze snapshot` (confirming the daemon captured the screenshot and the CLI reached the AI step). Alternatively, verify the snapshot PNG and HTML files exist on disk.

### Phase 5: SKILL.md update and full verification

Update skill documentation to reflect that `[ref=eN]` selectors now work when using daemon-backed sessions, and clarify limitations for non-daemon sessions. Run the full test suite.

- [ ] In `packages/libretto/skills/libretto/SKILL.md`, update the `exec` section: note that `[ref=eN]` aria-ref labels from `snapshot` output can be used as Playwright selectors in `exec` within the same session opened via `libretto open`. For sessions created via `libretto connect`, refs do not persist across calls — use semantic selectors instead.
- [ ] Run `pnpm sync:mirrors` to propagate to `.agents/skills/` and `.claude/skills/`.
- [ ] Run `pnpm check:mirrors` — passes with no drift.
- [ ] Run the full test suite: `pnpm --filter libretto test` — all existing tests plus all new daemon IPC tests pass.
- [ ] Run `pnpm --filter libretto type-check` — passes.
