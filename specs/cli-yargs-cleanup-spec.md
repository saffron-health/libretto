## Problem overview

The recent yargs migration still uses manual argument surgery in `cli.ts` (`filterSessionArgs`) and command registration via factory-style `registerBrowserCommands(...)` in `commands/browser.ts`. Review feedback requests a cleaner args flow and direct command object exports.

These patterns make the command wiring less idiomatic for yargs and add extra custom parsing paths that are harder to reason about.

## Solution overview

Refactor the CLI bootstrap to rely on yargs-native parsed argv shape for command detection and session handling, removing the dedicated `filterSessionArgs` helper. Replace browser command factory registration with direct `CommandModule` exports (`open`, `save`, `close`) and register those modules in `cli.ts`.

Keep user-visible behavior stable: same usage/error text where currently asserted by tests, same exit codes, and same command semantics.

## Goals

- Remove manual `--session` stripping in favor of cleaner argv handling aligned with yargs.
- Convert browser commands to direct exported yargs command objects rather than a factory function.
- Preserve current CLI behavior and test expectations for help, unknown commands, and missing argument errors.

## Non-goals

- No migrations or backfills.
- No functional changes to browser lifecycle (`open/save/close`) behavior.
- No broad command-module style conversion for non-browser command files in this spec.
- No launcher extraction work in `core/browser.ts` in this spec.

## Future work

- Convert `commands/execution.ts`, `commands/logs.ts`, and `commands/snapshot.ts` to direct `CommandModule` exports for consistency.
- Move the inline launcher script from `core/browser.ts` into a dedicated module/template file.

## Important files/docs/websites for implementation

- `packages/libretto/src/cli.ts` — current command bootstrap, usage printing, and pre-parse argument handling.
- `packages/libretto/src/commands/browser.ts` — current browser command registration factory to convert.
- `packages/libretto/src/cli-basic.test.ts` — assertions on error/help behavior that must remain stable.
- `packages/libretto/src/cli-stateful.test.ts` — stateful command assertions to guard regressions.
- [yargs command modules](https://yargs.js.org/docs/#api-reference-commandmodule) — canonical pattern for exporting command objects.
- [yargs command API](https://yargs.js.org/docs/#api-reference-commandcmd-desc-builder-handler) — details for command registration and handlers.

## Implementation

### Phase 1: Simplify CLI args flow in `cli.ts`

- [ ] Remove `filterSessionArgs` and replace it with a cleaner command-token derivation approach that does not mutate argv arrays manually.
- [ ] Keep `validateLegacySessionArg` semantics for the existing `--session` error contract.
- [ ] Ensure help/unknown-command fast paths continue to print the same root usage text and exit codes.
- [ ] Success criteria: `pnpm --filter libretto test` still passes `cli-basic.test.ts` assertions for `--help`, `help`, unknown command, and invalid `--session` cases.

### Phase 2: Convert browser commands to direct command modules

- [ ] Replace `registerBrowserCommands(yargs)` with exported `CommandModule` objects for `open`, `save`, and `close` in `commands/browser.ts`.
- [ ] Register these command objects directly in `cli.ts` (e.g., `.command(openCommand)` style).
- [ ] Keep existing usage-error strings for missing required args to avoid behavior regressions.
- [ ] Success criteria: browser command registration remains discoverable and behavior remains unchanged when invoked from CLI tests.

### Phase 3: Validation and regression guardrails

- [ ] Run `pnpm --filter libretto type-check`.
- [ ] Run `pnpm --filter libretto test`.
- [ ] Run `pnpm --filter libretto build`.
- [ ] Success criteria: all three commands pass with no new test failures and no output-contract changes in existing tests.
