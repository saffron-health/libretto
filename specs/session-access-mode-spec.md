## Problem overview

Libretto currently treats browser sessions as reconnectable endpoints without a first-class access mode attached to the session itself. That makes the read-only workflow rely on command choice (`readonly-exec`) and skill instructions instead of a per-session policy that follows the session whether it was created by `open`, `run`, or `connect`.

For agent-driven terminal workflows, that is the wrong boundary. The safer model is to store access mode on the session and let terminal commands enforce it consistently, while still allowing normal interactive workflows and `run` scripts to use full Playwright behavior in write-enabled sessions.

## Solution overview

Add a session-level access mode field stored in `.libretto/sessions/<session>/state.json` with two explicit values: `read-only` and `write-access`. Persist that mode whenever Libretto creates or adopts a session through `open`, `run`, or `connect`, defaulting all three to `write-access` unless the caller passes `--read-only` at creation time.

Treat session access mode as a terminal-command guard, not as a browser-runtime sandbox. In `read-only` sessions, terminal commands that attach new terminal-side Playwright code to an existing session must fail before browser interaction, while the existing read-only inspection surface defined by `readonly-exec` and related session-inspection commands remains available. `resume` also remains allowed in `read-only` sessions because it continues an already-running workflow rather than injecting new terminal-side Playwright code. `run` remains allowed because it starts a new workflow-owned browser session rather than attaching terminal commands to an existing preserved session. In `write-access` sessions, `run` and `exec` keep their full Playwright behavior.

## Goals

- Every Libretto session created or adopted through `open`, `run`, or `connect` persists an explicit session access mode in session state.
- Session mode names are `read-only` and `write-access`.
- `open`, `run`, and `connect` default new sessions to `write-access`.
- `open`, `run`, and `connect` accept `--read-only` to create a read-only session directly.
- `run` keeps full Playwright capability for its workflow script when the target session has `write-access`.
- Terminal commands enforce session mode consistently, so a `read-only` session blocks mutating attach-style terminal commands before they touch the browser.
- Read-only inspection flows continue to work through the existing `readonly-exec` restrictions and other observational commands.
- `resume` remains allowed in `read-only` sessions.
- `run` remains allowed and creates a new `write-access` workflow session.
- The behavior works the same for local browser sessions and remote CDP sessions connected through `connect`.

## Non-goals

- No migrations or backfills.
- No browser-level or CDP-level security sandbox beyond Libretto CLI command guards.
- No attempt to prevent mutation by callers that already know and directly use the raw CDP endpoint outside Libretto.
- No changes to `run` workflow semantics beyond persisting `write-access` on the new workflow session it creates.
- No redesign of the existing `readonly-exec` helper surface or read-only restriction set beyond any small changes needed to fit the new session-mode guard.

## Future work

None yet. Add follow-up items during implementation if new scope is intentionally deferred.

## Important files/docs/websites for implementation

- `packages/libretto/packages/libretto/src/shared/state/session-state.ts` — session state schema that should become the source of truth for per-session access mode.
- `packages/libretto/packages/libretto/src/cli/core/session.ts` — session state read/write helpers used across commands.
- `packages/libretto/packages/libretto/src/cli/core/browser.ts` — `open` and `connect` session creation paths that should persist `write-access` by default.
- `packages/libretto/packages/libretto/src/cli/commands/execution.ts` — `exec`, `readonly-exec`, `run`, and `resume` command entry points where new-session vs existing-session behavior must stay clear.
- `packages/libretto/packages/libretto/src/cli/core/readonly-exec.ts` — existing implementation of the read-only inspection surface that this spec should reuse rather than redefine.
- `packages/libretto/packages/libretto/src/cli/commands/browser.ts` — browser command surface and help text for `open` and `connect`.
- `packages/libretto/packages/libretto/src/cli/router.ts` — CLI command registration if a new `session-mode` command is added or restored.
- `packages/libretto/packages/libretto/test/fixtures.ts` — subprocess fixtures for seeding session state and session mode.
- `packages/libretto/packages/libretto/test/basic.spec.ts` — help and usage coverage for any new or updated command surface.
- `packages/libretto/packages/libretto/test/stateful.spec.ts` — end-to-end session-mode behavior tests for local and remote-style sessions.
- `packages/libretto/packages/libretto/skills/libretto/SKILL.md` — interactive skill guidance for `write-access` sessions.
- `packages/libretto/packages/libretto/skills/libretto-readonly/SKILL.md` — read-only diagnosis guidance that should align with session-level enforcement.
- `api/src/worker/jobDebuggingAgent.ts` — hosted read-only debugger flow that should create or adopt sessions marked `read-only`.
- `packages/libretto/specs/open-read-only-mode-spec.md` — earlier direction that this spec supersedes by moving mode to session state and restoring `write-access` defaults.
- `packages/libretto/specs/readonly-exec-spec.md` — existing read-only inspection command spec that remains relevant once session mode is enforced at the CLI boundary.

## Implementation

### Phase 1: Add session-level access mode to state

- [x] Extend session state schema in `packages/libretto/packages/libretto/src/shared/state/session-state.ts` with `mode: "read-only" | "write-access"`.
- [x] Update session state helpers and any seed fixtures so tests can read and write the new field directly from session state instead of relying on global permission config.
- [x] Persist `mode: "write-access"` when `open` creates a local browser session unless `--read-only` is passed.
- [x] Persist `mode: "write-access"` when `connect` adopts a remote CDP session unless `--read-only` is passed.
- [x] Persist `mode: "write-access"` when `run` creates or refreshes a session it owns unless `--read-only` is passed.
- [x] Success criteria: sessions created through `open`, `run`, and `connect` all write an explicit mode into session state, and `--read-only` flips the created session mode without needing a follow-up command.

### Phase 2: Add a session-mode command for explicit mode changes

- [x] Add a `session-mode` CLI command that shows the current mode for a session and optionally sets it to `read-only` or `write-access`.
- [x] Keep the command session-scoped by reading and writing `.libretto/sessions/<session>/state.json`.
- [x] Use `read-only` and `write-access` consistently in usage text, errors, and docs.
- [x] Success criteria: a user can run `libretto session-mode --session <name>` to inspect the current mode, while `open`, `connect`, and `run` can create read-only sessions directly with `--read-only`.

### Phase 3: Enforce terminal command guards from session mode

- [x] Add a shared guard helper that reads session mode and rejects disallowed attach-style commands before connecting to the browser.
- [x] Block `exec` in `read-only` sessions while leaving `resume` allowed.
- [x] Keep read-only inspection commands allowed in `read-only` sessions, including `readonly-exec`, `snapshot`, `pages`, and other observational session-inspection commands already covered by the existing read-only Libretto logic.
- [x] Leave `run` allowed and keep it creating a new `write-access` workflow session with full Playwright capability.
- [x] Return deterministic error text that names the blocked command, the session, and the current mode, and points users at `session-mode write-access` when they intentionally want to unlock an existing session.
- [x] Success criteria: commands blocked by `read-only` mode fail before any browser interaction on the existing session, while `run` still starts a fresh workflow session unchanged.

### Phase 4: Cover local and remote session flows with tests

- [x] Replace or update old permission-based test fixtures so stateful tests seed session mode directly on session state.
- [x] Add tests that `open` and `connect` create `write-access` sessions by default.
- [x] Add tests that `run` creates a fresh `write-access` session and still works normally regardless of unrelated existing `read-only` sessions.
- [x] Add tests that `exec` is rejected in `read-only` sessions while `readonly-exec` still succeeds.
- [x] Add tests that `resume` remains allowed in `read-only` sessions when a workflow is paused.
- [x] Add at least one test that simulates a remote CDP-backed session by seeding `cdpEndpoint` in session state and confirming the same mode guard behavior applies.
- [x] Success criteria: targeted CLI tests verify mode persistence and guard behavior for both local and remote session shapes without asserting internal formatting details.

### Phase 5: Align docs and hosted read-only agent flows

- [x] Update Libretto docs and help text to explain that session mode is stored on the session, defaults to `write-access`, supports `--read-only` at creation time, and is enforced only through Libretto terminal commands.
- [x] Update `libretto-readonly` guidance to assume sessions handed to diagnosis agents are explicitly marked `read-only`.
- [x] Update any hosted debugger wiring that prepares a preserved session so it marks the session `read-only` before handing it to a terminal agent.
- [x] Clarify in docs that `libretto connect` does persist `read-only` or `write-access` on the resulting Libretto session, but any caller that separately uses the raw CDP endpoint outside Libretto bypasses Libretto session-mode enforcement.
- [x] Success criteria: the docs show a clear story for interactive `write-access` work, deliberate relocking to `read-only`, and read-only diagnosis of remote CDP sessions through Libretto.
