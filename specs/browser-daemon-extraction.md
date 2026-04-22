# Extract browser daemon launcher into a real module

## Problem overview

The browser daemon is launched via an inline JavaScript string (~150 lines) built with string interpolation and `.toString()` serialization of functions. This makes the code fragile, untestable, and hard to extend. The daemon also sleeps forever (`await new Promise(() => {})`) and never exits when the user closes Chrome, leaving zombie Node processes and stale session state files.

## Solution overview

Extract the inline launcher code into a standalone TypeScript module (`browser-daemon.ts`) that receives configuration via CLI arguments. The daemon process imports its dependencies normally instead of inlining them. Add browser disconnect detection so the daemon exits and cleans up session state when Chrome closes.

## Goals

- The browser daemon launcher is a real TypeScript file that gets built and imported normally.
- The daemon exits cleanly when the user closes the Chrome window, cleaning up session state.
- `libretto open` + `libretto exec` + `libretto close` continue to work exactly as before.

## Non-goals

- No migrations or backfills.
- No exec server in the daemon (future work).
- No changes to the `run` command or its worker process.
- No changes to cloud provider sessions (they don't use the local daemon).
- No connection pooling or persistent exec state across calls.

## Future work

- **Exec server in the daemon.** Once the daemon is a proper module, add an HTTP/Unix socket server that accepts exec requests. The CLI `exec` command becomes a thin client, eliminating per-call CDP reconnection and enabling persistent `execState` across calls. `snapshot`, `readonly-exec`, and `list-pages` could also be served.
- **Unify browser launch code.** The `run` command's worker uses `shared/run/browser.ts` (`launchBrowser()`), which duplicates significant logic with `runOpen()` in `cli/core/browser.ts`: free port selection, Chromium launch args, viewport resolution, window positioning, session state writing, auth profile loading. After extraction, the daemon module and `launchBrowser()` will both be proper modules that import dependencies normally, making it possible to factor out a shared `launchChromium()` helper that both paths call. The key differences are: (1) the daemon is a detached long-lived process while the worker is a short-lived detached process, (2) the daemon installs session telemetry in-process while the worker also does but additionally loads and runs a user workflow module, (3) the daemon navigates to a URL while the worker delegates navigation to the workflow. A shared core would handle: port selection, Chrome launch args, context creation with viewport/storage state, window positioning, and session state file writing. Each caller would then add its own lifecycle (sleep-forever vs run-workflow-and-exit) and telemetry setup.
- **Daemon monitors all pages closing.** The `browser.on('disconnected')` event fires when the Chromium process dies, but not when the user closes the last tab (Chrome stays alive with zero tabs). Detecting "all operational pages closed" would require polling or CDP target events.

## Important files/docs for implementation

- `packages/libretto/src/cli/core/browser.ts` — Contains `runOpen()` with the inline launcher string (~L410-630), `connect()`, `disconnectBrowser()`, `tryConnectToCDP()`, `runClose()`. The primary file being refactored.
- `packages/libretto/src/cli/core/session-telemetry.ts` — `installSessionTelemetry()`, currently `.toString()`'d into the launcher string. Will be imported normally after extraction.
- `packages/libretto/src/shared/dom-semantics.ts` — Constants and functions (`filterSemanticClasses`, `isObfuscatedClass`, etc.) currently `JSON.stringify`'d / `.toString()`'d into the launcher. Will be imported normally.
- `packages/libretto/src/cli/core/session.ts` — `writeSessionState()`, `clearSessionState()`, `readSessionState()` for session lifecycle management.
- `packages/libretto/src/shared/state/session-state.ts` — `SessionStateFileSchema`, `SessionState` type.
- `packages/libretto/src/cli/core/context.ts` — `getSessionNetworkLogPath()`, `getSessionActionsLogPath()`, `logFileForSession()`.
- `packages/libretto/src/shared/run/browser.ts` — `launchBrowser()` used by the `run` worker. Relevant for future unification (see Future Work) but not modified in this spec.
- `packages/libretto/src/cli/workers/run-integration-runtime.ts` — The `run` worker runtime. Relevant for future unification but not modified in this spec.

## Implementation

### Phase 1: Create the daemon module with CLI arg parsing

Extract the inline launcher code into a real TypeScript file that receives its configuration via a JSON CLI argument, imports dependencies normally, and launches the browser. This phase does not yet wire it into `runOpen()` — it just creates the file and verifies it compiles.

```ts
// packages/libretto/src/cli/core/browser-daemon.ts
import { chromium } from "playwright";
import { installSessionTelemetry } from "./session-telemetry.js";
// ... normal imports

type DaemonConfig = {
  port: number;
  url: string;
  session: string;
  headed: boolean;
  viewport: { width: number; height: number };
  logFile: string;
  networkLogFile: string;
  actionsLogFile: string;
  storageStatePath?: string;
  windowPosition?: { x: number; y: number };
};

const config: DaemonConfig = JSON.parse(process.argv[2]);

const browser = await chromium.launch({
  headless: !config.headed,
  args: [
    "--disable-blink-features=AutomationControlled",
    `--remote-debugging-port=${config.port}`,
    "--remote-debugging-address=127.0.0.1",
    "--no-focus-on-check",
  ],
});
// ... context, page, telemetry setup, goto, signal handlers
```

- [x] Create `packages/libretto/src/cli/core/browser-daemon.ts` that parses a JSON config from `process.argv[2]`
- [x] The daemon launches Chromium, creates context/page, installs telemetry, navigates to URL, and sleeps (matching current behavior)
- [x] Import `installSessionTelemetry` and dom-semantics directly instead of `.toString()` serialization
- [x] Include signal handlers (`SIGTERM`, `SIGINT`) and logging (`childLog`) from the current inline code
- [x] Simplified: window position uses only `--window-position` Chrome launch arg (CDP `Browser.setWindowBounds` removed — unnecessary for fresh Chromium processes)
- [x] Verify `pnpm --filter libretto type-check` passes

### Phase 2: Wire `runOpen()` to spawn the daemon module

Replace the inline launcher string in `runOpen()` with a `spawn()` call that passes a minimal config as a JSON CLI argument to the new daemon module. The daemon is spawned via `node --import tsx` so it can import `.ts` files at runtime. The daemon derives its own log file paths from the session name using the standard `context.ts` helpers, so the config only carries fields the daemon can't derive itself.

```ts
// In runOpen(), replacing the launcherCode string + spawn:
const daemonEntryPath = fileURLToPath(
  new URL("./browser-daemon.ts", import.meta.url),
);
const daemonConfig = {
  port,
  url,
  session,
  headed,
  viewport,
  storageStatePath: useProfile ? profilePath : undefined,
  windowPosition,
};
const child = spawn(
  process.execPath,
  ["--import", "tsx", daemonEntryPath, JSON.stringify(daemonConfig)],
  { detached: true, stdio: ["ignore", "ignore", childStderrFd] },
);
```

- [x] Replace the `launcherCode` string and its `spawn("node", ["--input-type=module", "-e", launcherCode])` call with a spawn of the daemon module via `node --import tsx`
- [x] Remove all the string interpolation, `.toString()` serialization, and `escaped*` variables that were only needed for the inline string
- [x] Simplify `DaemonConfig`: daemon derives log paths from session name via `context.ts` helpers (`getSessionLogsPath`, `getSessionNetworkLogPath`, `getSessionActionsLogPath`), removing `logFile`, `networkLogFile`, `actionsLogFile` fields
- [x] Remove unused imports from `browser.ts`: dom-semantics, `installSessionTelemetry`, `createRequire`, `basename`, `resolve`, `getSessionActionsLogPath`, `getSessionNetworkLogPath`
- [x] Verify `pnpm --filter libretto type-check` passes
- [x] Manual test: `pnpm -s cli open https://example.com --headed` launches browser, `pnpm -s cli exec 'return await page.title()'` returns the page title, `pnpm -s cli close` shuts it down
- [x] Manual test: logs written to correct session directory (`logs.jsonl`, `network.jsonl`, `actions.jsonl`)

### Phase 3: Exit on browser disconnect and clean up session state

Make the daemon exit when Chromium disconnects (user closes the browser window or the process crashes), and clean up the session state file on the way out. This fixes the zombie daemon problem.

```ts
// In browser-daemon.ts, replacing the current no-op disconnect handler:
browser.on("disconnected", () => {
  childLog("info", "browser-disconnected-exiting", { port: config.port });
  // Clean up session state so CLI doesn't think a session is still active
  try {
    if (existsSync(sessionStatePath)) {
      unlinkSync(sessionStatePath);
    }
  } catch {}
  process.exit(0);
});
```

- [ ] Replace `await new Promise(() => {})` with a pattern that exits on browser disconnect (e.g., a promise that resolves on the `disconnected` event)
- [ ] On disconnect, delete the session state file before exiting
- [ ] Retain `SIGTERM`/`SIGINT` handlers for `libretto close` to still work
- [ ] Manual test: `pnpm -s cli open https://example.com --headed`, close the Chrome window manually, verify the Node daemon process exits and the session state file is cleaned up (i.e., `pnpm -s cli status` shows no active session)
- [ ] Manual test: `pnpm -s cli open https://example.com --headed`, then `pnpm -s cli close` still works as before
