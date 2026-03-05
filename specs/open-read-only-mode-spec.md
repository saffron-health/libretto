## Problem overview

`libretto-cli open` currently starts sessions that always allow `exec`, which means an agent can immediately run arbitrary Playwright code against live websites. That default is risky for sensitive workflows where accidental clicks, form submissions, or mutation requests are not acceptable.

## Solution overview

Make `open` sessions read-only by default and require explicit opt-in for automation via a new `--allow-actions` flag. Enforce the safety boundary in `exec` so read-only sessions reject execution with a clear remediation message.

## Goals

- New `open` sessions default to read-only mode.
- Users can explicitly opt into interactive automation with a CLI flag.
- `exec` is blocked for read-only sessions with actionable error text.
- Help/usage and repository docs explain the new default and opt-in path.
- CLI tests cover both blocked and allowed session modes.

## Non-goals

- No migrations or backfills.
- No AST-level parsing of `exec` code to allow a subset of read-only Playwright APIs.
- No changes to browser-agent runtime semantics outside `libretto-cli` session state/guards.

## Future work

- Add a finer-grained safe mode that allows non-mutating `exec` reads while blocking mutating actions.
- Add a dedicated command to toggle an existing session between read-only and interactive without reopening.

## Important files/docs/websites for implementation

- `packages/libretto-cli/src/index.ts` — Open/exec runtime behavior, usage text, and session state writes.
- `packages/libretto-cli/src/cli-basic.test.ts` — Usage error assertions for CLI command help strings.
- `packages/libretto-cli/src/cli-stateful.test.ts` — Seeded-state subprocess tests for mode-based exec behavior.
- `packages/libretto-cli/src/test-fixtures.ts` — Session state fixture typing used by stateful tests.
- `README.md` — Top-level CLI documentation updates for default read-only behavior and explicit opt-in.

## Implementation

### Phase 1: Add session mode state and default read-only open behavior

- [x] Extend CLI session state to store session mode (`read-only` or `interactive`).
- [x] Add `--allow-actions` flag handling to `open` and default mode to `read-only`.
- [x] Persist mode when creating or reusing an `open` session.
- [x] Update `open` usage strings/help output to include the new flag.
- [x] Success criteria: missing-URL `open` usage output includes `--allow-actions` and new sessions persist read-only mode unless opted in.

### Phase 2: Enforce exec safety boundary

- [x] Add an `exec` guard that rejects execution in read-only sessions before browser interaction.
- [x] Return a clear error message telling users to re-open with `--allow-actions`.
- [x] Success criteria: `exec` exits non-zero in read-only sessions with a deterministic guard message.

### Phase 3: Cover behavior with subprocess tests and docs

- [x] Add stateful tests for read-only blocked exec and interactive-mode pass-through behavior.
- [x] Update top-level documentation to describe the new default and opt-in behavior.
- [x] Run the CLI Vitest suite to validate changes.
- [x] Success criteria: `pnpm --filter libretto-cli test` passes.
