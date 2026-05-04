## Problem overview

Libretto currently has two IPC systems: the generic typed peer in `packages/libretto/src/shared/ipc/ipc.ts` and a daemon-specific Unix-socket NDJSON protocol in `packages/libretto/src/cli/core/daemon/ipc.ts`. Workflow lifecycle communication is split again across signal files (`.paused`, `.resume`, `.completed`, `.failed`, `.output`), so `run`, `resume`, `pause`, `exec`, `pages`, and `snapshot` do not share one runtime connection contract.

This duplication makes the browser daemon boundary harder to reason about and keeps `packages/libretto/src/shared/debug/pause.ts` coupled to CLI internals.

## Solution overview

Move the daemon command protocol onto the existing typed `shared/ipc` peer and use a persistent Unix-socket transport that supports bidirectional messages. Then introduce a `WorkflowRunner` supervisor that forks workflow code into a child process and uses the same `shared/ipc` peer over Node child-process IPC for pause/completion/failure messages.

The first useful version should preserve the existing `DaemonClient` call surface and CLI behavior, then remove signal-file control flow in small steps. The daemon stays responsible for browser/session lifetime and CLI IPC; `WorkflowRunner` becomes responsible for workflow child lifecycle, output forwarding, status, and resume.

## Goals

- `open`, `connect`, `pages`, `exec`, `readonly-exec`, and `snapshot` use the typed `shared/ipc` protocol instead of the custom daemon request/response protocol.
- `run` receives workflow output, completed, failed, and paused outcomes over the daemon connection instead of polling signal files.
- `resume` reconnects to the daemon and resumes a paused workflow through the daemon-owned `WorkflowRunner` instead of writing a `.resume` file.
- `pause(session)` no longer imports CLI internals or writes `.paused/.resume` files; in workflow children it pauses by making a parent IPC call that resolves only when resumed.
- Session state remains sufficient for a new CLI invocation to find the daemon socket and resume or inspect a session.
- Existing user-visible command behavior remains stable unless this spec explicitly changes it.

## Non-goals

- No migrations or backfills.
- No removal of `state.json` session metadata.
- No rewrite of browser launch/connect/provider lifecycle beyond the communication boundary.
- No public plugin API for daemon events.
- No cloud or cross-machine transport support beyond the current local daemon model.
- No change to the session access-mode permission model.
- No generalized workflow job queue; `WorkflowRunner` supervises one workflow invocation for one daemon session.

## Future work

- To be filled during implementation.

## Important files/docs/websites for implementation

- `packages/libretto/src/shared/ipc/ipc.ts` — existing typed request/response peer to reuse for daemon communication.
- `packages/libretto/src/shared/ipc/ipc.spec.ts` — unit coverage for the generic IPC peer.
- `packages/libretto/src/cli/core/daemon/ipc.ts` — current custom daemon client/server protocol and spawn helper.
- `packages/libretto/src/cli/core/daemon/daemon.ts` — daemon process, request dispatch, workflow execution, and shutdown behavior.
- `packages/libretto/src/cli/core/daemon/config.ts` — daemon startup configuration passed to the child process.
- `packages/libretto/src/cli/core/daemon/index.ts` — legacy daemon barrel to remove once imports are direct.
- `packages/libretto/src/cli/core/workflow-runner/` — new parent/child workflow runner modules to add for workflow supervision and child-process IPC.
- `packages/libretto/src/cli/commands/execution.ts` — `run`, `resume`, `exec`, and `readonly-exec` command behavior.
- `packages/libretto/src/cli/core/browser.ts` — `open`, `connect`, `pages`, `snapshot`, `close`, and daemon spawn callsites.
- `packages/libretto/src/cli/core/pause-signals.ts` — signal-file helpers to stop using and eventually remove.
- `packages/libretto/src/shared/debug/pause.ts` — user-facing pause primitive that currently writes signal files and imports CLI internals.
- `packages/libretto/src/shared/paths/paths.ts` — shared session and pause signal path helpers.
- `packages/libretto/src/shared/state/session-state.ts` — durable session metadata, including `daemonSocketPath` and status.
- `packages/libretto/test/daemon-ipc.spec.ts` — behavior coverage for daemon-backed `pages`, `exec`, `readonly-exec`, `snapshot`, and run-created sessions.
- `packages/libretto/test/basic.spec.ts` — behavior coverage for `run`, `pause`, `resume`, session lifecycle, and CLI output.
- `packages/libretto/test/stateful.spec.ts` — behavior coverage for session permissions and readonly execution.
- `packages/libretto/test/multi-page.spec.ts` — behavior coverage for page listing and page targeting.
- [Node net documentation](https://nodejs.org/api/net.html) — Unix domain socket server/client behavior and connection lifecycle.
- [Node child_process documentation](https://nodejs.org/api/child_process.html) — daemon spawn, child IPC startup handshake, detached processes, and stdio configuration.

## Implementation

### Phase 1: Add a persistent Unix-socket transport for `shared/ipc`

Create the transport adapter needed to run `createIpcPeer` over a long-lived daemon socket. Keep this phase independent from the daemon so the framing, disconnect, and concurrent-call behavior is testable in isolation.

```ts
function createJsonSocketTransport(
  socket: Socket,
): IpcTransport<IpcProtocolMessage> {
  return {
    send: (message) => writeJsonLine(socket, message),
    listen: (callback) => onJsonLine(socket, callback),
  };
}

async function listenForIpcConnections(
  path: string,
  onConnection: (transport: IpcTransport<IpcProtocolMessage>) => void,
) {
  const server = createServer((socket) =>
    onConnection(createJsonSocketTransport(socket)),
  );
  await listenOnUnixSocket(server, path);
  return server;
}
```

- [x] Add a Node transport module under `packages/libretto/src/shared/ipc/` that adapts a `net.Socket` to `IpcTransport<IpcProtocolMessage>` using newline-delimited JSON framing.
- [x] Add helpers for connecting a client socket and accepting server connections without introducing daemon-specific types.
- [x] Ensure the server removes a stale Unix socket path before listening and unlinks it on close.
- [x] Add unit coverage that sends two concurrent calls over one socket and receives both responses correctly.
- [x] Add unit coverage that destroying one peer rejects pending calls when the socket closes.
- [x] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 1.5: Add a child-process transport for `shared/ipc`

Add a second transport adapter for Node child-process IPC so `WorkflowRunner` and the workflow child can use the same peer abstraction as daemon IPC. Keep it generic and independent from workflow concepts.

```ts
function createChildProcessIpcTransport(
  child: ChildProcess,
): IpcTransport<IpcProtocolMessage> {
  return {
    send: (message) => child.send(message),
    listen: (callback) => listenForIpcMessages(child, callback),
  };
}

function createParentProcessIpcTransport(): IpcTransport<IpcProtocolMessage> {
  return {
    send: (message) => process.send?.(message),
    listen: (callback) => listenForIpcMessages(process, callback),
  };
}
```

- [x] Add child-process IPC transport helpers under `packages/libretto/src/shared/ipc/`.
- [x] Filter incoming `process.on("message")` payloads so only `IpcProtocolMessage` values reach `createIpcPeer`.
- [x] Throw a clear error when the child-side transport is created without `process.send`.
- [x] Add unit coverage that a parent and forked child can call each other through `createIpcPeer`.
- [x] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 1.6: Evaluate richer IPC error serialization

Decide whether the generic IPC peer should preserve richer error details across process and socket boundaries by adopting a focused error serialization library such as `serialize-error`, or by expanding the current in-repo serializer. Keep the wire protocol explicit and avoid changing daemon/workflow behavior unless the added error fidelity is intentionally accepted.

Decision: keep a focused in-repo serializer instead of adding `serialize-error`. `serialize-error` provides broad fidelity for arbitrary custom properties, non-`Error` values, circular references, and deserialization, but the generic IPC boundary should avoid transmitting every enumerable error field by default because daemon/workflow errors may carry credentials, URLs, headers, or other sensitive metadata. The accepted default is to preserve debugging-critical fields with an explicit wire shape: `name`, `message`, `stack`, primitive `code`, nested `cause`, and `AggregateError.errors`. Non-`Error` thrown values are represented as `NonError` with a string message, and recursive error references are capped as `[Circular]`. No dependency was adopted, so no new Node/runtime/ESM compatibility constraint was introduced.

- [x] Compare the current `{ name, message, stack }` serializer with `serialize-error` for custom properties, `cause`, `AggregateError`, non-`Error` thrown values, circular references, and deserialization.
- [x] Decide whether richer metadata should be transmitted by default, considering user-visible debugging value and accidental exposure of sensitive error fields.
- [x] If adopting a dependency, verify its runtime constraints fit Libretto's supported Node versions and ESM packaging.
- [x] Update `SerializedError` and `deserializeRemoteError` in `packages/libretto/src/shared/ipc/ipc.ts` or introduce a focused internal error serialization module.
- [x] Add IPC unit coverage for at least nested `cause`, custom `code`, and non-`Error` thrown values.
- [x] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 2: Define the typed daemon protocol and wrap it in the existing `DaemonClient`

Introduce daemon API types that mirror the current daemon commands while preserving the public `DaemonClient` methods used by CLI commands. This lands typed protocol definitions without changing user-visible behavior.

Completed: `packages/libretto/src/cli/core/daemon/ipc.ts` now owns the daemon protocol types and the `DaemonClient` wrapper over `createIpcPeer`. Clients connect with `await DaemonClient.connect(socketPath)`, then call the remote daemon through a concrete peer instead of a promise-valued member. `exec` and `readonlyExec` still model user-code failures as `DaemonCommandResult` values so captured stdout/stderr remain available to CLI callers; other daemon method errors use the shared IPC runtime's rejected-call behavior.

```ts
type CliToDaemonApi = {
  ping(): { protocolVersion: number };
  pages(): Array<{ id: string; url: string; active: boolean }>;
  exec(args: {
    code: string;
    pageId?: string;
    visualize?: boolean;
  }): DaemonExecResult;
  readonlyExec(args: { code: string; pageId?: string }): DaemonExecResult;
  snapshot(args: { pageId?: string }): DaemonSnapshotResult;
};

class DaemonClient {
  async pages() {
    return this.peer.call.pages();
  }
}
```

- [x] Add daemon protocol types, naming the request API `CliToDaemonApi` and the event API `DaemonToCliApi`, in `packages/libretto/src/cli/core/daemon/ipc.ts` or a focused sibling module.
- [x] Reimplement `DaemonClient.ping`, `pages`, `exec`, `readonlyExec`, and `snapshot` through `createIpcPeer` while keeping their current caller-facing return shapes.
- [x] Preserve `DaemonCommandResult` semantics for `exec` and `readonlyExec`, including returning captured stdout/stderr on user-code errors.
- [x] Keep `DaemonClient.spawn`, `waitForReadyMessage`, and `getDaemonSocketPath` behavior unchanged in this phase.
- [x] Verify existing daemon behavior with `pnpm -s test --filter=libretto -- daemon-ipc.spec.ts`.
- [x] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 3: Replace the daemon server dispatcher with typed IPC handlers

Move the daemon process from custom `DaemonServer` request handling to typed `shared/ipc` handlers. The CLI should still be able to run all existing daemon-backed commands after this phase.

Completed: `packages/libretto/src/cli/core/daemon/daemon.ts` now creates an IPC socket server with `createIpcSocketServer`/`listenOnIpcSocket` and attaches typed `createIpcPeer` handlers for each connected CLI. The obsolete daemon-specific request/response parser and dispatcher were removed from `ipc.ts`; `pages` and `snapshot` let shared IPC serialize handler errors, while `exec` and `readonlyExec` convert user-code failures into explicit result values. IPC server lifecycle is owned by `BrowserDaemon.initialize()` and cleaned up through registered shutdown handlers rather than being stored on `BrowserDaemon` itself.

```ts
function createDaemonHandlers(
  daemon: BrowserDaemon,
): IpcPeerHandlers<CliToDaemonApi> {
  return {
    ping: () => ({ protocolVersion: PROTOCOL_VERSION }),
    pages: () => handlePages(daemon.pagesById, daemon.primaryPage),
    exec: (args) => daemon.runExec(args),
    readonlyExec: (args) => daemon.runReadonlyExec(args),
    snapshot: (args) => daemon.captureSnapshot(args),
  };
}
```

- [x] Replace `DaemonServer` usage in `packages/libretto/src/cli/core/daemon/daemon.ts` with the shared IPC socket server transport.
- [x] Move the current `dispatchCommand` cases into typed handler functions without changing page resolution, timeout, or error messages.
- [x] Keep the startup `process.send({ type: "ready", socketPath, provider })` handshake intact.
- [x] Ensure multiple client connections can call daemon methods during one daemon lifetime.
- [x] Remove or quarantine obsolete custom `DaemonRequest`/`DaemonResponse` parsing only after all callsites compile.
- [x] Verify `pnpm -s test --filter=libretto -- daemon-ipc.spec.ts multi-page.spec.ts stateful.spec.ts socket-transport.spec.ts` passes.

### Phase 3.1: Remove the daemon barrel module

Delete `packages/libretto/src/cli/core/daemon/index.ts` and import daemon modules directly. Barrel files hide module ownership and make refactors harder to review; direct imports keep callsites explicit within the package.

- [ ] Replace imports from `packages/libretto/src/cli/core/daemon/index.ts` with direct imports from `daemon/ipc.ts` or `daemon/config.ts`.
- [ ] Delete `packages/libretto/src/cli/core/daemon/index.ts`.
- [ ] Run `rg "core/daemon/index|core/daemon\.js|from \".*daemon/index\.js\"|from \".*core/daemon\"" packages/libretto/src packages/libretto/test` and confirm no daemon barrel imports remain.
- [ ] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 4: Introduce `WorkflowRunner` protocol and supervisor shell

Define the parent/child workflow IPC contract and add a `WorkflowRunner` class that can supervise a child process. Keep the existing in-daemon workflow execution path active until the child can reconnect to the browser in the next phase.

```ts
type WorkflowChildToParentApi = {
  pause(args: { session: string; pausedAt: string; url?: string }): Promise<void>;
  workflowCompleted(args: { completedAt: string }): void;
  workflowFailed(args: { message: string; phase: "setup" | "workflow" }): void;
};

type WorkflowParentToChildApi = {
  shutdown(args: { reason: string }): void;
};

class WorkflowRunner {
  start(): void;
  resume(): void;
  getStatus(): WorkflowStatus;
}
```

- [ ] Add `packages/libretto/src/cli/core/workflow-runner/protocol.ts` with `WorkflowChildToParentApi`, `WorkflowParentToChildApi`, `WorkflowStatus`, and `WorkflowOutcome` types.
- [ ] Add `packages/libretto/src/cli/core/workflow-runner/runner.ts` with a `WorkflowRunner` shell that owns child process state, stdout/stderr forwarding callbacks, status, and `resume()`.
- [ ] Implement the parent-side `pause` handler so it sets status to paused, emits a paused outcome, and deliberately does not resolve until `resume()` is called.
- [ ] Add child exit handling that reports an exited/failed outcome if the child exits before completion, failure, or pause is reported.
- [ ] Do not move workflow execution out of `BrowserDaemon.runWorkflow` yet.
- [ ] Add focused unit coverage for the `pause` handler: the child call remains pending until `WorkflowRunner.resume()` is invoked.
- [ ] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 5: Run workflow code in a child process supervised by `WorkflowRunner`

Move workflow execution into a child entrypoint. The child installs the child-side `shared/ipc` peer, connects to the daemon-owned browser over CDP, runs the workflow, and reports pause/completion/failure to `WorkflowRunner` over child-process IPC.

```ts
type WorkflowChildConfig = {
  session: string;
  cdpEndpoint: string;
  pageId?: string;
  workflow: DaemonWorkflowConfig;
};

async function runWorkflowChild(config: WorkflowChildConfig) {
  const parent = createIpcPeer<WorkflowChildToParentApi, WorkflowParentToChildApi>(
    createParentProcessIpcTransport(),
    { shutdown: async () => process.exit(0) },
  );
  installWorkflowParentPeer(parent);
  await runLoadedWorkflow(config);
}
```

- [ ] Add `packages/libretto/src/cli/core/workflow-runner/child.ts` as the workflow child entrypoint.
- [ ] Add a serializable `WorkflowChildConfig` that includes `session`, workflow config, CDP endpoint, and the page identity needed to resolve the target page.
- [ ] Have the child connect to the daemon-owned browser over CDP instead of receiving in-memory Playwright objects.
- [ ] Reuse existing workflow loading, visualization, and action logging behavior in the child process where the `Page` object lives.
- [ ] Pipe child stdout/stderr through `WorkflowRunner` so output can be forwarded to daemon events without `.output` files.
- [ ] Have `BrowserDaemon` instantiate and start `WorkflowRunner` when `config.workflow` exists.
- [ ] Preserve current behavior-level run tests before removing signal-file compatibility.
- [ ] Verify `pnpm -s test --filter=libretto -- basic.spec.ts daemon-ipc.spec.ts` passes.

### Phase 6: Send workflow output and outcomes from `WorkflowRunner` to CLI daemon events

Connect the child-runner outcomes to the daemon's `DaemonToCliApi` event stream. This phase replaces `.output`, `.completed`, `.failed`, and `.paused` polling for `run` outcome detection.

```ts
type DaemonToCliApi = {
  workflowOutput(args: { stream: "stdout" | "stderr"; text: string }): void;
  workflowPaused(args: { pausedAt: string; url?: string }): void;
  workflowCompleted(args: { completedAt: string }): void;
  workflowFailed(args: { message: string; phase: "setup" | "workflow" }): void;
};

async function waitForWorkflowOutcome(client: DaemonClient): Promise<WorkflowOutcome> {
  return client.waitForWorkflowEventOutcome();
}
```

- [ ] Add optional CLI event handlers when constructing a daemon IPC client for `run` and `resume` paths.
- [ ] Broadcast `WorkflowRunner` stdout/stderr events through `DaemonToCliApi.workflowOutput`.
- [ ] Broadcast `WorkflowRunner` paused/completed/failed outcomes through `DaemonToCliApi`.
- [ ] Update `waitForWorkflowOutcome` in `packages/libretto/src/cli/commands/execution.ts` to wait on daemon events and process liveness instead of signal files.
- [ ] Remove `.paused` polling from `waitForWorkflowOutcome` once daemon pause events are authoritative.
- [ ] Add or adjust behavior coverage where a workflow logs before completion and `librettoCli("run ...")` includes that output and `Integration completed.`.
- [ ] Add behavior coverage for normal `pause(ctx.session)` flow where `librettoCli("run ...")` reports `Workflow paused.`.
- [ ] Verify `pnpm -s test --filter=libretto -- basic.spec.ts daemon-ipc.spec.ts` passes.

### Phase 7: Resume paused workflow children over the daemon connection

Expose `WorkflowRunner` status and resume through `CliToDaemonApi`. A new CLI invocation reconnects to the daemon socket, verifies the runner is paused, calls `resumeWorkflow()`, and then waits for the next daemon workflow event.

```ts
type CliToDaemonApi = {
  getWorkflowStatus(): WorkflowStatus;
  resumeWorkflow(): void;
};

class BrowserDaemon {
  resumeWorkflow() {
    this.workflowRunner?.resume();
  }
}
```

- [ ] Add `getWorkflowStatus()` and `resumeWorkflow()` to the typed daemon API.
- [ ] Delegate daemon `getWorkflowStatus()` and `resumeWorkflow()` to the active `WorkflowRunner`.
- [ ] Change `runResume` in `packages/libretto/src/cli/commands/execution.ts` to connect to `sessionState.daemonSocketPath`, call `getWorkflowStatus()`, then call `resumeWorkflow()`.
- [ ] Preserve current user-facing errors for sessions that are not paused or whose daemon process is no longer running.
- [ ] After resuming, wait for daemon workflow events and keep existing behavior for completion, failure, second pause, and `--stay-open-on-success`.
- [ ] Stop writing `.resume` from `runResume`.
- [ ] Add behavior coverage for a workflow that pauses twice: initial `run` reports `Workflow paused.`, first `resume` reports `Workflow paused.`, second `resume` reports `Integration completed.`.
- [ ] Verify `pnpm -s test --filter=libretto -- basic.spec.ts` passes.

### Phase 8: Move `pause(session)` onto the workflow child parent IPC peer

Remove the shared pause primitive's dependency on CLI internals by making it call the installed workflow parent peer from inside a workflow child. The parent `pause` handler resolves only when `WorkflowRunner.resume()` is called, so `await pause(session)` naturally suspends and continues workflow code.

```ts
let workflowParentPeer: IpcPeer<WorkflowChildToParentApi> | undefined;

export function installWorkflowParentPeer(peer: IpcPeer<WorkflowChildToParentApi>) {
  workflowParentPeer = peer;
}

export async function pause(session: string): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  await getWorkflowParentPeerOrThrow().call.pause({
    session,
    pausedAt: new Date().toISOString(),
    url: "unknown",
  });
}
```

- [ ] Add a workflow child pause bridge module that has no imports from `packages/libretto/src/cli/core`.
- [ ] Update `packages/libretto/src/shared/debug/pause.ts` to use the workflow parent peer for non-production pauses.
- [ ] Install the workflow parent peer in the workflow child entrypoint before user workflow code runs.
- [ ] Preserve helpful guidance when `pause(session)` is called outside a Libretto workflow child.
- [ ] Add behavior coverage for `pause("")` guidance and normal `pause(ctx.session)` / `resume` flow through `librettoCli`.
- [ ] Verify `pnpm -s test --filter=libretto -- basic.spec.ts` and `pnpm -s type-check --filter=libretto` pass.

### Phase 9: Gracefully close daemon sessions over IPC before falling back to process signals

Use the same connection for controlled shutdown where possible, especially provider-backed sessions that can return replay metadata. Keep SIGTERM/SIGKILL as a fallback for unreachable daemons.

```ts
type CliToDaemonApi = {
  close(args?: { closeBrowser?: boolean }): { replayUrl?: string };
};

async function closeDaemonSession(state: SessionState) {
  const client = await DaemonClient.connect(state.daemonSocketPath);
  return client.close({ closeBrowser: true });
}
```

- [ ] Add `close()` to the typed daemon API and implement it through `BrowserDaemon.shutdown`.
- [ ] Update `runClose` to try daemon `close()` before sending SIGTERM to the daemon process.
- [ ] Return provider replay URL from `close()` when available and keep the existing direct provider cleanup fallback for unreachable daemons.
- [ ] Keep force-close behavior for daemons that do not respond within the existing close timeout.
- [ ] Add behavior coverage that `close --session <name>` still reports `Browser closed` for a daemon-backed local session.
- [ ] Verify `pnpm -s test --filter=libretto -- stateful.spec.ts daemon-ipc.spec.ts` passes.

### Phase 10: Remove signal-file control flow and stale path helpers

Delete the signal-file code after all daemon workflow communication goes through IPC. Leave durable session state and normal logs intact.

- [ ] Remove unused code from `packages/libretto/src/cli/core/pause-signals.ts` or delete the file if no imports remain.
- [ ] Remove pause signal path helpers from `packages/libretto/src/shared/paths/paths.ts` if they are no longer used.
- [ ] Remove signal cleanup, `streamOutputSince`, `readFailureDetails`, and signal polling helpers from `packages/libretto/src/cli/commands/execution.ts`.
- [ ] Ensure tests do not assert internal `.libretto` file layout or signal-file existence.
- [ ] Run `rg "pausedSignal|resumeSignal|completedSignal|failedSignal|outputSignal|getPauseSignalPaths|\.resume|\.paused" packages/libretto/src packages/libretto/test` and confirm only intentional documentation or migration notes remain.
- [ ] Verify `pnpm -s test --filter=libretto` and `pnpm -s type-check --filter=libretto` pass.
