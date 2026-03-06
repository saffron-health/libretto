## Problem overview

`debugPause` currently blocks inside the same process that runs `libretto-cli run`, so `run` hangs indefinitely when a workflow hits `debugPause`. The current implementation also relies on `.paused/.resume` files, which are implementation-heavy and not aligned with the desired runtime contract.

The desired behavior is: `libretto-cli run` starts workflow execution in a child process, waits until that child either completes or pauses, then returns immediately. `debugPause` should never block `libretto run`.

## Solution overview

Move workflow execution for `run` into a dedicated worker child process and use Node IPC for status signaling (`completed`, `paused`, `failed`). Replace file-based `debugPause` behavior with an in-process pause signal (typed error) that the worker catches and reports to the parent via IPC, then keeps the worker alive in paused state.

`libretto-cli run` becomes a supervisor: it launches the worker, streams worker stdout/stderr, and exits when it receives either completion or pause outcome. On pause, it exits successfully and prints a clear paused status message while the worker remains running (hung) at pause.

## Goals

- `libretto-cli run ... --debug` returns instead of hanging when workflow code calls `debugPause(...)`.
- `debugPause` no longer uses `.paused/.resume` files.
- `run` uses parent/child IPC to detect paused/completed/failed outcomes.
- CLI output clearly indicates paused outcome (for example, `Workflow paused.`), while still surfacing workflow logs before the pause.
- Paused worker remains alive after parent `run` command returns.
- Existing non-`debugPause` run behavior (success/failure paths) remains intact.

## Non-goals

- No migrations or backfills.
- No resume/continue command in this spec (paused is a terminal outcome for the `run` invocation).
- No redesign of `open`, `exec`, or session permission model.
- No generic background job orchestration system.

## Future work

- To be filled during implementation.

## Important files/docs/websites for implementation

- `packages/libretto/src/debug/pause.ts` — current blocking, file-based pause implementation to replace.
- `packages/libretto/src/debug/index.ts` — debug export surface.
- `packages/libretto-cli/src/commands/execution.ts` — current inline `run` execution path; will become parent supervisor path.
- `packages/libretto-cli/src/cli.ts` — run help text/output contract updates.
- `packages/libretto-cli/src/debug-pause-run.test.ts` — regression test that currently times out; target test for new behavior.
- `packages/libretto-cli/src/cli-basic.test.ts` — add/adjust subprocess assertions for run paused/completed behavior.
- `packages/libretto-cli/src/test-fixtures.ts` — CLI fixture contract used by subprocess tests.
- `packages/libretto-cli/tsup.config.ts` — include worker entrypoint in build outputs.
- [Node child_process.fork docs](https://nodejs.org/api/child_process.html#child_processforkmodulepath-args-options) — worker process creation with IPC.
- [Node child process IPC/stdin/stdout docs](https://nodejs.org/api/child_process.html#optionsstdio) — required `stdio`/`ipc` wiring.
- [Node process.send docs](https://nodejs.org/api/process.html#processsendmessage-sendhandle-options-callback) — child-to-parent messaging contract.

## Implementation

### Phase 1: Replace file-based `debugPause` with typed pause signal

- [ ] In `packages/libretto/src/debug/pause.ts`, remove `.paused/.resume` file IO and wait loop behavior.
- [ ] Introduce a typed pause signal (for example, `DebugPauseSignal` + guard helper) that includes at least `url` and `pausedAt`.
- [ ] Make `debugPause` behavior:
  - return immediately when disabled,
  - log pause context when enabled,
  - throw the typed pause signal when enabled.
- [ ] Ensure exports in `packages/libretto/src/debug/index.ts` and package root remain coherent for new pause signal types/helpers.
- [ ] Success criteria: add/adjust unit tests to verify enabled `debugPause` throws typed signal and disabled `debugPause` is a no-op, with no file artifacts created.

### Phase 2: Add `run` worker entrypoint with IPC status messages

- [ ] Create a dedicated worker module in `packages/libretto-cli/src` for running one workflow invocation.
- [ ] Move the existing inline workflow execution logic (import workflow export, launch browser, run handler, close browser) into worker-owned code.
- [ ] In worker, catch typed pause signal, send IPC `{ type: "paused", ... }` to parent, then deliberately stay alive in paused state (do not exit).
- [ ] Ensure paused-state worker keeps browser/context open for inspection while hung.
- [ ] In worker, send/emit failure details for non-pause errors and exit non-zero.
- [ ] Update `packages/libretto-cli/tsup.config.ts` to build this worker entry as a runnable output.
- [ ] Success criteria: worker can be launched by Node with IPC and emits deterministic message payloads for paused/completed/failed paths, and paused path does not terminate worker.

### Phase 3: Convert `run` command into supervisor parent process

- [ ] In `packages/libretto-cli/src/commands/execution.ts`, replace direct `runIntegrationFromFile(...)` invocation with worker launch via `child_process.fork(...)` using IPC enabled stdio.
- [ ] Stream worker stdout/stderr through parent stdout/stderr so existing logs remain visible.
- [ ] Handle worker outcomes:
  - on paused message: print `Workflow paused.` (or the chosen exact status string) and treat command as success,
  - on completed outcome: keep current success behavior (`Integration completed.`),
  - on failed outcome/non-zero exit: preserve actionable error path and non-zero CLI exit.
- [ ] Ensure parent does not hang waiting for a resume signal once paused is reported.
- [ ] Ensure parent pause-return path does not kill/cleanup the paused worker process.
- [ ] Success criteria: `pnpm --filter libretto-cli test -- src/debug-pause-run.test.ts` passes and no timeout occurs.

### Phase 4: Regression coverage and output contract updates

- [ ] Update `packages/libretto-cli/src/debug-pause-run.test.ts` to assert the new paused-status output in addition to `WORKFLOW_BEFORE_PAUSE`.
- [ ] Add/adjust a `cli-basic.test.ts` case verifying `run` still reports completion on a workflow with no pause signal.
- [ ] Update help text/docs (`packages/libretto-cli/src/cli.ts` and relevant README snippets) so `--debug` behavior is described as returning paused status rather than blocking.
- [ ] Success criteria:
  - `pnpm --filter libretto-cli test -- src/debug-pause-run.test.ts src/cli-basic.test.ts`
  - `pnpm --filter libretto-cli test`
  - `pnpm --filter libretto-cli build`
