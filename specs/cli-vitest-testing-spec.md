## Problem overview

The repository has no automated tests for the CLI. The CLI is stateful and side-effect heavy (filesystem state, spawned processes, and browser connectivity), so regressions in command behavior are easy to miss.

The focus of this worktree is to establish reliable test infrastructure for CLI testing in scoped temporary workspaces and add a small set of basic CLI tests.

## Solution overview

Set up Vitest at the workspace level, add CLI-focused fixtures that isolate each test in its own workspace, and run the built CLI as a subprocess for black-box assertions.

Do not refactor or edit `packages/libretto-cli/src/index.ts` in this spec. Tests should validate current behavior from the outside.

## Goals

- Add workspace test infrastructure using Vitest.
- Add reusable fixtures for isolated CLI testing in scoped workspaces.
- Add basic CLI subprocess tests for help, usage errors, and a small set of deterministic commands.
- Ensure tests are offline and do not require live LLM credentials.
- Add CI execution for the test suite.

## Non-goals

- No migrations or backfills.
- No edits to `packages/libretto-cli/src/index.ts` in this worktree.
- No broad core-library test expansion in `packages/libretto` yet.
- No real browser end-to-end automation against external websites.
- No parser/helper extraction refactor for testability in this phase.

## Future work

- Expand CLI coverage to more command paths once infrastructure is stable.
- Add focused unit tests for extracted helpers after a separate refactor-focused worktree.
- Add broader `packages/libretto` unit and integration tests.

## Important files/docs/websites for implementation

- `package.json` — workspace scripts and shared dev dependencies.
- `pnpm-workspace.yaml` — workspace package boundaries.
- `packages/libretto-cli/package.json` — CLI package scripts and dependencies.
- `packages/libretto-cli/vitest.config.ts` — package-local Vitest configuration for inline CLI tests.
- `packages/libretto-cli/src/index.ts` — CLI runtime behavior under test (read-only for this spec).
- `README.md` — top-level project context.

## Implementation

### Phase 1: Add Vitest workspace scaffolding

- [x] Add workspace-level dev dependency for `vitest`.
- [x] Add root scripts: `test` and `test:watch`.
- [x] Add package-level Vitest config and root test orchestration through package scripts.
- [x] Add package-level test scaffolding for stable smoke-test execution.
- [x] Success criteria: `pnpm test` runs and passes with initial smoke tests.

### Phase 2: Add scoped-workspace CLI fixtures

- [x] Add a fixture that creates a unique temp workspace per test and switches subprocess cwd into it.
- [x] Add seed helpers for `.libretto-cli` and `tmp/libretto-cli` state files and run directories.
- [x] Add a `spawnCli` fixture that executes the built CLI and captures `exitCode`, `stdout`, and `stderr`.
- [x] Add teardown cleanup that removes temp workspace artifacts after each test.
- [x] Success criteria: two tests can run in parallel without shared state collisions.

### Phase 3: Add very basic CLI subprocess tests

- [x] Add tests for `--help`/`help` output.
- [x] Add tests for unknown command behavior and non-zero exit code.
- [x] Add tests for missing argument usage errors on `open`, `exec`, and `save`.
- [x] Add tests for invalid `--session` usage and error messaging.
- [x] Success criteria: tests assert both exit code and user-visible stderr/stdout text.

### Phase 4: Add deterministic state-driven CLI tests

- [x] Add tests for `snapshot configure --show` when no config is set.
- [x] Add tests for `snapshot configure <preset>` and `snapshot configure --clear` state transitions.
- [x] Add tests for `network` and `actions` commands using seeded log files in temp run dirs.
- [x] Add tests for `network --clear` and `actions --clear` behavior against seeded files.
- [x] Success criteria: stateful command tests run without launching a browser process.

### Phase 5: Add CI execution and guardrails

- [x] Add CI workflow step to run `pnpm test`.
- [x] Ensure tests write only within temp workspaces and never mutate repo-local runtime state.
- [x] Document the test strategy and fixture constraints briefly in the spec or test README.
- [x] Success criteria: CI passes in a clean environment and reproduces local test results.
