# Persistent exec sandbox via daemon exec server

## Problem overview

Every `libretto exec` call creates a fresh CDP connection, compiles the code into an `AsyncFunction`, runs it with fresh helpers, and disconnects. Nothing persists across calls — variables, helper functions, and intermediate results are all lost. The per-call CDP reconnection also adds latency.

## Solution overview

Add an HTTP server (Unix socket) to the browser daemon that accepts exec requests. The daemon maintains a persistent execution context using Node's `repl` module, where all user-defined variables, functions, and classes survive across calls. The CLI `exec` command becomes a thin client that sends code to the daemon and prints the result. Playwright `page`/`context`/`browser` are injected into the REPL context — no per-call reconnection.

```js
// exec 1
const users = await page.locator(".user").allTextContents();
function filterAdmins(list) {
  return list.filter((u) => u.includes("admin"));
}

// exec 2 — users and filterAdmins are still available
filterAdmins(users);
```

### How persistence works

Node's `repl.start()` creates a REPL instance with a persistent context. It handles `const`, `let`, `var`, `function`, `class`, destructuring, and top-level `await` out of the box — all declarations survive across evaluations. No code transforms, AST parsing, or regex needed. The daemon creates one REPL for exec mode and one for readonly-exec mode, each with the appropriate helpers injected into its context.

The only pre-processing needed:

1. Strip TypeScript types via `node:module.stripTypeScriptTypes` (same as current behavior)
2. Strip leading `return` keyword for backward compatibility (current exec compiles to a function where `return` is valid; REPL-style evaluation uses the last expression's value instead)

## Goals

- All user-defined variables, functions, and classes persist across `exec` calls within a local session
- `readonly-exec` also gets a persistent context (separate from `exec`'s, with read-only page proxy)
- Per-call CDP reconnection is eliminated for local sessions
- Existing `open → exec → close` workflow is unchanged from the user's perspective

## Non-goals

- No migrations or backfills
- No cloud provider exec server support (tracked as Notion task NTN-389)
- No crash isolation via worker threads
- No changes to the `run` command or its worker process
- No serving `snapshot` or `list-pages` through the exec server

## Future work

- **Cloud provider exec server.** Spawn a local daemon that connects to a remote CDP endpoint instead of launching Chromium, giving cloud sessions the same persistent context. (Notion NTN-389)
- **Serve snapshot and list-pages.** These also do per-call CDP connect/disconnect and could be served by the daemon.
- **Reset state command.** A `--fresh` flag on exec that clears the persistent context without restarting the session.

## Important files/docs for implementation

- `packages/libretto/src/cli/core/browser-daemon.ts` — The long-lived daemon process. Exec server and REPL instances go here.
- `packages/libretto/src/cli/commands/execution.ts` — Contains `runExec()`, `compileExecFunction()`, `stripEmptyCatchHandlers()`, `execCommand`, `readonlyExecCommand`. The CLI becomes a thin client.
- `packages/libretto/src/cli/core/readonly-exec.ts` — `createReadonlyExecHelpers()` for read-only mode. Will be imported by the daemon.
- `packages/libretto/src/cli/core/browser.ts` — `runOpen()` (spawns daemon, writes session state), `connect()`, `disconnectBrowser()`, `runClose()`.
- `packages/libretto/src/shared/state/session-state.ts` — `SessionStateFileSchema` and `SessionState` type. Needs new `execSocketPath` field.
- `packages/libretto/src/cli/core/session.ts` — `writeSessionState()`, `readSessionState()`, `clearSessionState()`.
- `packages/libretto/src/cli/core/context.ts` — Session path helpers. Will add `getSessionExecSocketPath()`.
- `packages/libretto/src/cli/core/telemetry.ts` — `readNetworkLog()`, `readActionLog()`, `wrapPageForActionLogging()`.
- Node.js `repl` module docs — `repl.start()` with custom streams for programmatic use.

## Implementation

### Phase 1: Write failing end-to-end tests for persistent exec state

Write the tests first so every subsequent phase has a clear pass/fail signal. These tests launch a real headless browser via `librettoCli`, run multiple exec calls, and assert that state persists. All tests should fail initially (exec currently creates fresh state each call).

```ts
// test/persistent-exec.spec.ts — uses writeHtml(title, body?) fixture from fixtures.ts
test("variable defined in one exec is available in the next", async ({ librettoCli, writeHtml }) => {
  const session = "persist-var";
  const url = await writeHtml("Test");
  await librettoCli(`open "${url}" --headless --session ${session}`);
  await librettoCli(`exec "const x = 42" --session ${session}`);
  const result = await librettoCli(`exec "x" --session ${session}`);
  expect(result.stdout.trim()).toBe("42");
});
```

- [x] Create `packages/libretto/test/persistent-exec.spec.ts`
- [x] Test: `const x = 42` in one exec, then `x` in the next → stdout is `42`
- [x] Test: `function double(n) { return n * 2 }` in one exec, then `double(21)` → stdout is `42`
- [x] Test: `class Adder { add(a, b) { return a + b } }` in one exec, then `new Adder().add(1, 2)` → stdout is `3`
- [x] Test: `const { a, b } = { a: 1, b: 2 }` in one exec, then `a + b` → stdout is `3`
- [x] Test: `return await page.title()` still works (backward compat with `return` keyword)
- [x] Test: `async function getTitle() { return await page.title() }` then `await getTitle()` → returns the page title (async function + top-level await persist)
- [x] Test: readonly-exec also persists state across calls (separate context from exec)
- [x] Test: exec error in one call doesn't break subsequent calls (`undeclaredVar` throws, then `1 + 1` → `2`)
- [x] Verify tests fail with current implementation: `pnpm --filter libretto test -- test/persistent-exec.spec.ts` (expected: 7 failures on persistence/expression-value assertions, 1 pass on `return` backward compat)

### Phase 2: Add exec socket path to session state

Define where the Unix socket lives and make the session state schema aware of it, so the CLI can discover the socket after `open`.

```ts
// context.ts
export function getSessionExecSocketPath(session: string): string {
  return join(getSessionDir(session), "exec.sock");
}
```

- [x] Add `getSessionExecSocketPath(session)` to `packages/libretto/src/cli/core/context.ts`
- [x] Add optional `execSocketPath: z.string().optional()` to `SessionStateFileSchema` in `packages/libretto/src/shared/state/session-state.ts`
- [x] In `runOpen()` in `browser.ts`, include `execSocketPath: getSessionExecSocketPath(session)` in the `writeSessionState()` call
- [x] Pass `execSocketPath` through to the daemon via `daemonConfig`
- [x] Verify `pnpm --filter libretto type-check` passes

### Phase 3: Add the exec server and persistent REPL to the daemon

The daemon starts an HTTP server on a Unix socket. It creates two `repl.start()` instances (exec and readonly-exec), each with appropriate helpers injected into their context. Each request strips TypeScript types, strips `return`, feeds code to the REPL, and returns the result.

```ts
// In browser-daemon.ts
import repl from "node:repl";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";

function createExecRepl(globals: Record<string, unknown>) {
  const input = new PassThrough();
  const output = new PassThrough();
  const r = repl.start({
    input,
    output,
    prompt: "",
    terminal: false,
    useGlobal: false,
  });
  Object.assign(r.context, globals);
  return { repl: r, input, output };
}

async function evalInRepl(
  replInstance: { repl: repl.REPLServer; input: PassThrough },
  code: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const origEval = replInstance.repl.eval;
    replInstance.repl.eval = (cmd, ctx, file, cb) => {
      origEval(cmd, ctx, file, (err, res) => {
        replInstance.repl.eval = origEval;
        if (err) reject(err);
        else resolve(res);
      });
    };
    replInstance.input.write(code + "\n");
  });
}
```

- [x] Move `stripEmptyCatchHandlers` from `execution.ts` into a new `packages/libretto/src/cli/core/exec-sandbox.ts` module (shared between daemon and CLI fallback)
- [x] Add `createExecRepl()` and `evalInRepl()` helpers in the daemon
- [x] Create two REPL instances at daemon startup: one for `exec` mode (full helpers including `page`, `context`, `browser`, `networkLog`, `actionLog`, `console`, `fetch`, etc.), one for `readonly-exec` (read-only helpers from `createReadonlyExecHelpers`)
- [x] Add an HTTP server to `browser-daemon.ts` that listens on `config.execSocketPath`
- [x] Implement `POST /exec` handler: accepts `{ code, mode, pageId?, visualize? }`, strips TS types via `node:module.stripTypeScriptTypes`, applies `stripEmptyCatchHandlers`, strips leading `return` for backward compat, feeds to the appropriate REPL via `evalInRepl()`
- [x] Return `{ ok: true, result }` on success, `{ ok: false, error: { message, stack } }` on failure
- [x] Handle page targeting: if `pageId` is provided, update the REPL context's `page` reference to the target page
- [x] Add stall-detection interval (60s) and structured `childLog` calls for exec-start/success/error
- [x] Clean up the Unix socket file in `shutdown()` (unlink alongside session state)
- [x] Verify `pnpm --filter libretto type-check` passes

### Phase 4: Make the CLI exec command a thin client

`runExec()` checks session state for `execSocketPath`. If the socket exists, send code to the daemon over HTTP. Otherwise fall back to the current direct-CDP behavior (for cloud sessions). After this phase, the Phase 1 tests should pass.

```ts
async function runExecViaDaemon(
  socketPath: string,
  code: string,
  mode: ExecMode,
  options: { pageId?: string; visualize?: boolean },
): Promise<void> {
  const body = await httpPostToSocket(socketPath, "/exec", {
    code,
    mode,
    pageId: options.pageId,
    visualize: options.visualize,
  });
  if (!body.ok) throw new Error(body.error.message);
  if (body.result !== undefined)
    console.log(
      typeof body.result === "string"
        ? body.result
        : JSON.stringify(body.result, null, 2),
    );
  else console.log("Executed successfully");
}
```

- [ ] Add `runExecViaDaemon()` using Node's `http.request` with `socketPath` option
- [ ] Modify `runExec()`: check `state.execSocketPath` — if socket exists, delegate to `runExecViaDaemon()`; otherwise fall back to existing direct-CDP logic
- [ ] Update the direct-CDP fallback to import `stripEmptyCatchHandlers` from `exec-sandbox.ts`
- [ ] Preserve stall-warning timer on client side (timeout on HTTP request)
- [ ] Preserve "Stripped `.catch(() => {})`" message on client side
- [ ] Verify `pnpm --filter libretto type-check` passes
- [ ] Verify Phase 1 tests pass: `pnpm --filter libretto test -- test/persistent-exec.spec.ts`
- [ ] Verify existing tests still pass: `pnpm --filter libretto test -- test/stateful.spec.ts`
