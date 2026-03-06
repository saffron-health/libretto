## Problem overview

Libretto runtime state is currently split across multiple roots: `.libretto-cli/`, `tmp/libretto-cli/`, and `tmp/libretto/`. This makes state hard to inspect, hard to clean up, and inconsistent between CLI and library runtime behavior.

`main` already moved AI/snapshot analyzer config into `.libretto/config.json`, but session metadata, profiles, logs, telemetry, debug signals, and snapshot artifacts are still spread across the legacy locations.

## Solution overview

Centralize all runtime and persistent state under a single `.libretto/` root with a stable per-session layout. Add a setup script that creates `.libretto/`, required subdirectories, and `.libretto/.gitignore` when missing. Remove legacy path migration code and update all writers/readers to the new paths.

Target layout:

```text
.libretto/
  .gitignore
  config.json
  profiles/
  sessions/
    <session-name>/
      state.json
      logs.jsonl
      network.jsonl
      actions.jsonl
      snapshots/
        <snapshot-run-id>/
          page.png
          page.html
```

## Goals

- All runtime/persistent state used by `libretto-cli` and default `libretto` runtime helpers is stored under `.libretto/`.
- Each session has an isolated directory at `.libretto/sessions/<session-name>/`.
- Per-session logging uses `logs.jsonl` instead of per-run `session.log`.
- Profiles are stored under `.libretto/profiles/`.
- `.libretto/config.json` remains the single config file and also holds session permission state.
- Legacy `.playwriter` and `.browser-tap` migration code is removed.
- A setup script creates `.libretto/` structure and `.libretto/.gitignore` automatically when missing.

## Non-goals

- No migrations or backfills of old state from `.libretto-cli/` or `tmp/`.
- No compatibility shims that continue writing to old paths in parallel.
- No schema/versioning redesign beyond what is needed to add session permission data to existing `.libretto/config.json`.
- No changes to Playwright behavior, browser launch semantics, or command UX beyond path and storage location updates.

## Future work

- None yet. Add follow-ups only if discovered during implementation.

## Important files/docs/websites for implementation

- `packages/libretto-cli/src/core/context.ts` — defines global state roots and currently contains legacy profile migration logic.
- `packages/libretto-cli/src/core/session.ts` — session state read/write, run directory helpers, and session permission persistence.
- `packages/libretto-cli/src/core/telemetry.ts` — network/actions log paths and read/clear behavior.
- `packages/libretto-cli/src/core/browser.ts` — `open/save/close` flow and child browser logging file paths.
- `packages/libretto-cli/src/commands/snapshot.ts` — snapshot PNG/HTML capture locations.
- `packages/libretto-cli/src/core/snapshot-analyzer.ts` — temporary analyzer output file handling and snapshot pair discovery.
- `packages/libretto-cli/src/core/ai-config.ts` — `.libretto/config.json` schema and read/write helpers to extend with session permissions.
- `packages/libretto-cli/src/cli.ts` — logger initialization path and usage text that currently documents legacy paths.
- `packages/libretto/src/run/browser.ts` — writes browser metadata to `tmp/libretto`.
- `packages/libretto/src/debug/pause.ts` — default pause/resume signal directory under `tmp/libretto`.
- `packages/libretto/src/step/runner.ts` — default `logDir` under `tmp/libretto/logs`.
- `packages/libretto-cli/src/test-fixtures.ts` and `packages/libretto-cli/src/cli-stateful.test.ts` — fixture seeding and assertions that encode current filesystem layout.
- `README.md` and `packages/libretto/README.md` — user-facing documentation of state file locations.
- `.gitignore` — root ignore policy that currently ignores `.libretto-cli/` and `tmp/`.

## Implementation

### Phase 1: Add `.libretto` setup bootstrap and canonical path helpers

- [x] Add a setup bootstrap helper that ensures `.libretto/`, `.libretto/sessions/`, `.libretto/profiles/`, and `.libretto/.gitignore` exist.
- [x] Define canonical helpers for `.libretto` root, session directory resolution, and per-session file paths (`state.json`, `logs.jsonl`, `network.jsonl`, `actions.jsonl`, snapshot root).
- [x] Invoke setup bootstrap from CLI startup and any runtime entry points that can write state before command handlers execute.
- [x] Remove `.playwriter` and `.browser-tap` migration code from startup path handling.
- [x] Success criteria: running `libretto-cli --help` in a fresh repo creates `.libretto/.gitignore` and subdirectories without creating `.libretto-cli/` or `tmp/libretto-cli/`.

### Phase 2: Move CLI session state and logs into per-session directories

- [x] Move session state file from `tmp/libretto-cli/<session>.json` to `.libretto/sessions/<session>/state.json`.
- [x] Replace run-directory/per-run log helpers with session-directory helpers and `logs.jsonl`.
- [x] Update logger initialization in `cli.ts` to write to per-session `logs.jsonl`.
- [x] After logger defaults move off `tmp/libretto-cli`, allow early `getLog()` usage on help/error paths without recreating legacy dirs.
- [x] Update `open` child process logging path to append JSONL entries to `.libretto/sessions/<session>/logs.jsonl`.
- [x] Success criteria: session commands (`open`, `close`, `exec` guard paths) operate using only `.libretto/sessions/<session>/state.json` + `logs.jsonl`.

### Phase 3: Move telemetry and snapshots to session-scoped `.libretto` paths

- [x] Move network/action telemetry files to `.libretto/sessions/<session>/network.jsonl` and `.libretto/sessions/<session>/actions.jsonl`.
- [x] Update `network` and `actions` read/clear commands to use the new per-session files.
- [x] Move snapshot captures to `.libretto/sessions/<session>/snapshots/<snapshot-run-id>/page.png` and `page.html`.
- [x] Require explicit snapshot PNG/HTML paths from the current `snapshot` command flow; remove implicit latest-pair lookup from previous runs.
- [x] Remove repository-scoped analyzer temp directories; use transient OS temp files and delete them after parse.
- [x] Success criteria: stateful tests prove network/actions/snapshot files are created under `.libretto/sessions/<session>/...` and no files are created in `tmp/libretto-cli/`.

### Phase 4: Consolidate session permission state into `.libretto/config.json`

- [ ] Extend `LibrettoConfigSchema` to include a `sessionPermissions` object keyed by session name with `read-only|interactive` values.
- [ ] Replace `.libretto-cli/session-permissions.json` reads/writes with config-backed reads/writes in `ai-config.ts` + `session.ts`.
- [ ] Ensure `session-mode` command behavior remains unchanged from a user perspective.
- [ ] Remove any remaining references to `.libretto-cli/session-permissions.json` from code and tests.
- [ ] Success criteria: `session-mode interactive --session <name>` persists mode in `.libretto/config.json` and `run/exec` guards still enforce the same rules.

### Phase 5: Move default `libretto` package runtime state out of `tmp/libretto`

- [ ] Change `launchBrowser` metadata path default to `.libretto/sessions/<session>/state.json`-compatible location (or sibling metadata file in the same session dir).
- [ ] Change `debugPause` default signal directory from `tmp/libretto` to `.libretto/sessions/<session>/`.
- [ ] Change runner default `logDir` from `tmp/libretto/logs` to a `.libretto/sessions/<session>/`-scoped logs location.
- [ ] Ensure these defaults remain overridable by explicit options.
- [ ] Success criteria: library defaults no longer create `tmp/libretto/*` in a fresh run.

### Phase 6: Tests, docs, and cleanup

- [ ] Update CLI fixtures/tests to seed/assert the new `.libretto` layout.
- [ ] Add regression coverage that asserts commands do not create `.libretto-cli/` or `tmp/libretto-cli/` paths.
- [ ] Update usage/help text and README references from old paths to `.libretto`.
- [ ] Update root `.gitignore` policy to stop relying on `.libretto-cli/` and `tmp/` for libretto runtime state; keep ignores aligned with new `.libretto/.gitignore`.
- [ ] Success criteria: `pnpm --filter libretto-cli test`, `pnpm --filter libretto-cli type-check`, and `pnpm --filter libretto type-check` pass with updated path expectations.
