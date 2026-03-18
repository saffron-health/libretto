## Problem overview

`packages/libretto` still writes default runtime state to `tmp/libretto`, even after the broader `.libretto` state centralization work in `libretto`.

Current gaps:
- `run/browser.ts` writes browser metadata to `tmp/libretto/<session>.json`.
- `debug/pause.ts` defaults pause/resume signal files to `tmp/libretto`.
- `step/runner.ts` defaults `logDir` to `tmp/libretto/logs`.

This keeps library runtime behavior inconsistent with the new `.libretto/*` layout and still creates legacy `tmp/` state.

## Solution overview

Move all default `packages/libretto` runtime paths to `.libretto/sessions/<session>/...` and remove legacy `tmp/libretto` defaults entirely.

Use one shared internal path helper module in `packages/libretto` so `launchBrowser`, `debugPause`, and `createRunner` resolve paths consistently. Write browser metadata to `.libretto/sessions/<session>/state.json`, keep pause signals in `.libretto/sessions/<session>/`, and store runner logs/artifacts in `.libretto/sessions/<session>/logs/` (with `logs.jsonl` as the structured log file).

## Goals

- `packages/libretto` defaults never write to `tmp/libretto/*`.
- Browser metadata is written to `.libretto/sessions/<session>/state.json`.
- Debug pause signal files (`<session>.paused`, `<session>.resume`) default to `.libretto/sessions/<session>/`.
- Runner defaults write logs/artifacts in session-scoped `.libretto/sessions/<session>/...` paths.
- Path decisions are centralized behind one helper module to avoid drift between runtime subsystems.

## Non-goals

- No migrations or backfills from existing `tmp/libretto/*` files.
- No compatibility fallback that reads/writes old `tmp/libretto` defaults.
- No redesign of runner logging format beyond relocating defaults and using the canonical `logs.jsonl` filename.
- No attempt to move pause signaling or append-only logs into `state.json`.
- No changes to browser launch semantics, debug behavior, or step execution logic beyond filesystem paths.

## Future work

- Add dedicated tests for `packages/libretto` runtime path behavior if/when a test harness is introduced for that package.

## Important files/docs/websites for implementation

- `packages/libretto/src/run/browser.ts` - current metadata write path and lifecycle cleanup.
- `packages/libretto/src/debug/pause.ts` - current default signal directory and pause/resume file handling.
- `packages/libretto/src/step/runner.ts` - current default `logDir`, `session.log` path, and debug pause invocation.
- `packages/libretto/src/step/types.ts` - `RunnerConfig` shape where session-aware defaults should be expressed.
- `packages/libretto/src/run/api.ts` and `packages/libretto/src/index.ts` - exported runtime API surface to keep consistent after path helper changes.
- `packages/libretto/README.md` - user-facing defaults currently documenting `tmp/libretto/logs`.
- `specs/libretto-state-centralization-spec.md` - umbrella spec where this work corresponds to remaining Phase 5 items.

## Implementation

### Phase 1: Add canonical runtime path helpers in `packages/libretto`

- [x] Add an internal helper module (for example `packages/libretto/src/runtime/paths.ts`) for `.libretto` runtime path resolution.
- [x] Add helpers for: session directory, session state path (`state.json`), pause signal directory, runner log directory, and runner log file path (`logs.jsonl`).
- [x] Ensure helper functions create required parent directories where write paths are used.

### Phase 2: Migrate browser metadata and debug pause defaults

- [x] Update `launchBrowser` default metadata path from `tmp/libretto/<session>.json` to `.libretto/sessions/<session>/state.json`.
- [x] Keep `state.json` payload explicit and minimal for runtime metadata (`session`, `port`, `startedAt`; include `pid` if useful for cleanup/observability).
- [x] If `state.json` already exists, update only runtime metadata fields instead of replacing unrelated keys.
- [x] Update `debugPause` default `signalDir` from `tmp/libretto` to `.libretto/sessions/<session>/`.
- [x] Update JSDoc/comments for `DebugPauseOptions.signalDir` to document the new default location.
- [x] Success criteria: `run/browser.ts` and `debug/pause.ts` import shared runtime path helper(s) instead of constructing `tmp/libretto` paths inline.
- [x] Success criteria: a debug run produces `.paused`/`.resume` files in `.libretto/sessions/<session>/` and no files under `tmp/libretto/`.

### Phase 3: Migrate runner defaults to session-scoped `.libretto` paths

- [x] Add `sessionName` to `RunnerConfig` (default `"libretto"`) so runner defaults are session-scoped.
- [x] Change runner default `logDir` from `tmp/libretto/logs` to `.libretto/sessions/<session>/logs`.
- [x] Change default structured log filename from `session.log` to `logs.jsonl`.
- [x] Ensure debug pause integration uses the same resolved session directory as runner defaults.
- [x] Success criteria: `createRunner({ sessionName: "my-session" })` writes logs/artifacts under `.libretto/sessions/my-session/` and does not create `tmp/libretto/`.

### Phase 4: Docs and verification

- [ ] Update `packages/libretto/README.md` to document new `.libretto/sessions/<session>/...` defaults.
- [ ] Mark corresponding Phase 5 checklist items in `specs/libretto-state-centralization-spec.md` as complete once implemented.
- [ ] Run `pnpm type-check`.
- [ ] Perform one local smoke run that exercises `launchBrowser`, `debugPause`, and runner logging defaults, then verify no new `tmp/libretto/*` files were created.
- [ ] Success criteria: docs and runtime behavior are aligned on `.libretto` defaults and validation commands pass.
