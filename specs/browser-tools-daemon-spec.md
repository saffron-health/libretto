## Problem overview

`libretto-browser-tools` keeps browser sessions, Playwright handles, page IDs, and snapshot-diff baselines in one in-process `SessionRegistry`. A host that performs each tool call in a short-lived process cannot reuse that state, so later calls lose the session IDs returned by `browser_open`.

## Solution overview

Add an optional Unix-socket daemon host to `libretto-browser-tools`. The daemon owns one caller-supplied `BrowserToolkit` for its lifetime, while short-lived typed clients connect, execute any existing browser tool, and disconnect without closing browser sessions.

Keep process launch and provider selection outside the package in v1. A future Eve extension can start a small host process in its sandbox, construct the desired provider there, and use this daemon client without changing the browser tools.

## Goals

- A host can serve one existing `BrowserToolkit` over a local Unix socket.
- Multiple sequential clients can use the same browser session, page IDs, and snapshot-diff cache.
- A typed client can execute all six current browser tools without importing Playwright objects.
- Disconnecting a client leaves the toolkit and its browser sessions running.
- Explicit daemon shutdown stops accepting calls, disposes the toolkit once, and removes the socket.
- Invalid requests and unavailable daemons return errors that tell callers what to do next.
- Existing in-process factories and adapters keep their current behavior.

## Non-goals

- No Eve extension or Eve dependency.
- No detached-process launcher or general-purpose CLI.
- No provider configuration format; the daemon host receives an already-created `BrowserToolkit`.
- No session restoration after the daemon process or its browser process exits.
- No HTTP, TCP, Windows named-pipe, or cross-machine transport.
- No daemon authentication or multi-tenant routing.
- No parallel execution within one toolkit; the daemon serializes tool calls.
- No remote borrowed-page support beyond what an already-created toolkit exposes.
- No migrations or backfills.

## Important files/docs/websites for implementation

- `packages/browser-tools/src/create-browser-tools.ts` — public toolkit factory and the six tools the daemon must host unchanged.
- `packages/browser-tools/src/tool.ts` — shared `BrowserTool` and `ToolResult` contracts.
- `packages/browser-tools/src/session-registry.ts` — in-process state that remains owned by the daemon.
- `packages/browser-tools/src/domain-policy.ts` — structured host error that must keep its policy and attempted URL across IPC.
- `packages/browser-tools/src/tools/tools.spec.ts` — current end-to-end tool behavior and real-browser fixtures.
- `packages/browser-tools/src/adapters/mcp/index.ts` — existing example of mapping serialized calls onto the toolkit.
- `packages/browser-tools/src/index.ts` — current public exports, which must remain compatible.
- `packages/browser-tools/package.json` — add the `./daemon` public subpath.
- `packages/browser-tools/tsup.config.ts` — per-file ESM build that will emit the daemon modules.
- `packages/libretto/src/shared/ipc/ipc.ts` — reference for typed request/response calls and remote error handling; do not import this package-internal module.
- `packages/libretto/src/shared/ipc/socket-transport.ts` — reference for newline-delimited JSON framing and socket cleanup; do not create a new shared package in v1.
- `packages/libretto/test/daemon-ipc.spec.ts` — reference for testing browser state across separate daemon clients.
- `docs/browser-tools/advanced.mdx` — current advanced browser-tools guidance.
- `docs/docs.json` — browser-tools documentation navigation.
- [Node.js net documentation](https://nodejs.org/api/net.html) — Unix socket server and client lifecycle.
- [Eve sandbox documentation](https://eve.dev/docs/sandbox) — future consumer that motivates a process-local socket daemon.
- [agent-browser Eve extension](https://github.com/vercel-labs/agent-browser/tree/main/packages/%40agent-browser/eve) — reference for keeping browser state in Eve's sandbox, not an implementation dependency.

## Implementation

### Phase 1: Define the daemon protocol and typed dispatch

Define a versioned, browser-tools-specific request contract and a dispatcher over an existing `BrowserToolkit`. Keep this layer independent of sockets so malformed input, tool selection, result envelopes, and known structured errors can be tested without a process boundary.

```ts
// packages/browser-tools/src/daemon/protocol.ts
type BrowserToolName = keyof BrowserToolkit["tools"];

type BrowserToolsDaemonApi = {
  ping(): { protocolVersion: 1 };
  execute(request: { tool: BrowserToolName; input: unknown }): Promise<unknown>;
  shutdown(): Promise<void>;
};

async function executeBrowserTool(
  toolkit: BrowserToolkit,
  request: { tool: BrowserToolName; input: unknown },
) {
  const tool = toolkit.tools[request.tool];
  const input = await validateToolInput(tool.inputSchema, request.input);
  return tool.execute(input);
}
```

- [ ] Add `packages/browser-tools/src/daemon/protocol.ts` with request, response, serialized-error, protocol-version, and browser-tool-name types.
- [ ] Derive tool names and typed client input/output from `BrowserToolkit["tools"]` instead of duplicating six method signatures.
- [ ] Validate untrusted IPC input through each tool's Standard Schema before calling `execute`.
- [ ] Preserve ordinary `{ ok: false, error }` tool results as successful RPC responses.
- [ ] Serialize thrown errors explicitly; preserve `DomainPolicyRestricted.domainPolicy` and `attemptedNavigationUrl` without copying arbitrary enumerable error fields.
- [ ] Return actionable errors for an unknown tool, invalid input, and protocol-version mismatch.
- [ ] Add focused unit tests for valid dispatch, rejected invalid input, unknown tools, and structured domain-policy errors.
- [ ] Verify `pnpm -s --filter libretto-browser-tools type-check` passes.

### Phase 2: Add package-local NDJSON socket framing

Implement the smallest transport needed by the daemon: newline-delimited JSON over a caller-provided Unix socket. Keep framing separate from browser behavior and reject malformed or partial messages without crashing the server.

```ts
// packages/browser-tools/src/daemon/socket-transport.ts
function attachJsonLines(
  socket: Socket,
  onMessage: (message: unknown) => void,
) {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    buffer = consumeCompleteJsonLines(buffer, onMessage);
  });
}

export async function connectDaemonSocket(socketPath: string) {
  const socket = createConnection(socketPath);
  await once(socket, "connect");
  return socket;
}
```

- [ ] Add package-local JSON-line encode/decode helpers under `packages/browser-tools/src/daemon/`.
- [ ] Support multiple messages and chunked messages on one socket.
- [ ] Correlate responses to requests with opaque request IDs so one client can have more than one pending call.
- [ ] Reject pending calls when the socket closes instead of leaving promises unresolved.
- [ ] Detect a live socket before listening; remove only a stale socket path and never unlink another running daemon's socket.
- [ ] Return actionable framing and connection errors without including full request payloads.
- [ ] Add transport tests for chunked input, two pending requests, malformed JSON, connection loss, and stale-socket recovery.
- [ ] Verify `pnpm -s --filter libretto-browser-tools test -- socket-transport` passes.

### Phase 3: Serve one toolkit for the daemon lifetime

Add a programmatic server that owns the socket lifecycle and a caller-supplied toolkit. Serialize tool calls through one queue so multiple short-lived clients cannot race the registry or one page's snapshot baseline.

```ts
// packages/browser-tools/src/daemon/server.ts
export async function serveBrowserTools(options: {
  socketPath: string;
  toolkit: BrowserToolkit;
}): Promise<BrowserToolsDaemon> {
  const calls = createSerialCallQueue();
  const server = await listenForClients(options.socketPath, (request) =>
    calls.run(() => dispatchDaemonRequest(options.toolkit, request)),
  );

  return createDaemonHandle(server, options.toolkit);
}
```

- [ ] Add `serveBrowserTools({ socketPath, toolkit })` under `packages/browser-tools/src/daemon/server.ts`.
- [ ] Accept more than one client connection during one daemon lifetime.
- [ ] Serialize all tool executions while allowing `ping` and client disconnects to complete without waiting for a browser call.
- [ ] Make `close()` idempotent: stop accepting calls, reject queued calls with next-step guidance, dispose the toolkit once, close clients, and unlink the socket.
- [ ] Implement remote `shutdown` so its acknowledgement is written before server teardown begins.
- [ ] Expose a `closed` promise so a host process can remain alive and observe normal or failed shutdown.
- [ ] Do not install global signal handlers; the host process remains responsible for calling `close()` on its own lifecycle events.
- [ ] Add server tests proving that client disconnect does not dispose the toolkit and explicit close does.
- [ ] Verify `pnpm -s --filter libretto-browser-tools test -- daemon/server` passes.

### Phase 4: Add the typed daemon client and public export

Expose a small client that connects to an existing daemon and retains the current tool input and result types. Keep connection lifetime distinct from daemon lifetime so normal clients cannot close browsers by disconnecting.

```ts
// packages/browser-tools/src/daemon/client.ts
const client = await connectBrowserToolsDaemon({ socketPath });

const opened = await client.execute("browser_open", {
  url: "https://example.com",
});

client.disconnect();
await client.shutdown();
```

- [ ] Add `connectBrowserToolsDaemon({ socketPath })`.
- [ ] Type `execute(name, input)` from the selected member of `BrowserToolkit["tools"]` and return that tool's `execute` result type.
- [ ] Run `ping` during connection and reject incompatible protocol versions with upgrade guidance.
- [ ] Make `disconnect()` close only the client socket.
- [ ] Make `shutdown()` an explicit daemon operation and reject further client calls after it starts.
- [ ] Reconstruct `DomainPolicyRestricted` on the client for the known structured wire error; use ordinary `Error` values for other host failures.
- [ ] Export the server, client, handle, and public protocol types from `libretto-browser-tools/daemon`.
- [ ] Add the `./daemon` export to `packages/browser-tools/package.json`; do not add a `bin` entry.
- [ ] Verify `pnpm -s --filter libretto-browser-tools build` emits the declared JavaScript and type declaration paths.

### Phase 5: Verify browser state across process clients

Exercise the real failure mode this daemon solves: one process owns the toolkit while separate clients perform later calls. Use a Vitest fixture to own the child process and cleanup instead of adding production process-launch code.

```ts
// packages/browser-tools/src/daemon/daemon.spec.ts
const first = await connectBrowserToolsDaemon({ socketPath });
const opened = await first.execute("browser_open", { url: testUrl });
first.disconnect();

const second = await connectBrowserToolsDaemon({ socketPath });
const status = await second.execute("browser_status", {
  sessionId: opened.sessionId,
});
```

- [ ] Add a test fixture that starts a child process hosting `createBrowserTools(new LocalBrowserProvider({ headless: true }))`.
- [ ] Open a page through one client, disconnect it, and use a second client to inspect and execute against the same session ID.
- [ ] Assert an exec followed by another call retains the daemon-side snapshot baseline and returns a snapshot diff.
- [ ] Close the browser session through the second client, then shut down the daemon and assert the child exits and the socket disappears.
- [ ] Add a failure-path test where the daemon exits with a pending request and the client rejects instead of hanging.
- [ ] Run `pnpm -s --filter libretto-browser-tools test`.
- [ ] Run `pnpm -s --filter libretto-browser-tools type-check`.

### Phase 6: Document the daemon boundary

Document when to choose the daemon API instead of the in-process factory. Show direct process hosting and short-lived clients, while stating that callers still own process launch, signal handling, provider credentials, and restart policy.

- [ ] Add `docs/browser-tools/daemon.mdx` with server and client examples.
- [ ] Explain that `disconnect()` preserves browser sessions while `shutdown()` disposes them.
- [ ] State that daemon loss ends all in-memory session and page IDs; v1 does not restore them.
- [ ] Warn that `browser_exec` runs in the daemon process and that the daemon must run inside the caller's chosen isolation boundary.
- [ ] Add the page to the browser-tools section in `docs/docs.json`.
- [ ] Link the daemon page from `packages/browser-tools/README.md` and `docs/browser-tools/advanced.mdx`.
- [ ] Run `pnpm -s lint`.
