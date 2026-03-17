## Problem overview

The CLI currently stores analyzer configuration in a snapshot-specific file (`.libretto/snapshot-config.json`) and snapshot-specific code paths. That makes it hard to reuse the same model configuration for new commands like `analyze-media`, and it prevents future non-media AI workflows from sharing one stable runtime config.

We need one generic config location and schema that is explicitly AI-focused, not snapshot-focused.

## Solution overview

Introduce a single top-level config file at `.libretto/config.json` with a top-level version and an `ai` section. Move AI analyzer config read/write/show/clear logic behind shared AI config helpers and wire CLI configuration under an `ai` command surface.

Snapshot analysis will consume shared AI config, but this spec only covers AI config extraction and wiring, not broader workflow features.

## Goals

- Store AI model runner configuration in a single generic file: `.libretto/config.json`.
- Use a top-level `version` field in that config file.
- Keep all model-runner configuration under an `ai` object.
- Include `updatedAt` metadata in AI config.
- Make AI configuration reusable by any command (media and non-media).
- Provide CLI configuration UX under an AI command surface.

## Non-goals

- No migrations or backfills.
- No compatibility read path for legacy `.libretto/snapshot-config.json`.
- No scope/profile system (global AI config only).
- No changes to prompt design for snapshot or future analyze-media features.
- No implementation of analyze-media command behavior in this spec.

## Future work

- Add optional per-command overrides (for example, separate model config for specific workflows).
- Add explicit `ai test` command to validate configured command prefix and JSON output contract.
- Add richer runtime controls (timeouts, retry policy, JSON mode strictness).

## Important files/docs/websites for implementation

- `packages/libretto/src/core/context.ts` — currently defines `.libretto` paths; must be updated to `.libretto/config.json` constants.
- `packages/libretto/src/core/snapshot-analyzer.ts` — currently owns snapshot-specific config schema and IO; AI config logic should be extracted from here.
- `packages/libretto/src/commands/snapshot.ts` — currently exposes `snapshot configure`; should be rewired to shared AI config handlers or alias behavior.
- `packages/libretto/src/cli.ts` — root usage text and command registration; add/adjust AI command help text.
- `packages/libretto/src/cli-stateful.test.ts` — stateful config tests must move from snapshot wording/path to AI wording/path.
- `packages/libretto/src/test-fixtures.ts` — fixture helper currently seeds `snapshot-config.json`; must seed `.libretto/config.json`.
- `README.md` — user-facing docs currently snapshot-specific; update to generic AI config instructions.
- [yargs command API](https://yargs.js.org/docs/#api-reference-commandcmd-desc-builder-handler) — reference for adding `ai` command surface cleanly.

## Implementation

### Phase 1: Define shared AI config model and file path

Create the minimal shared config contract and storage location first. This phase establishes a single source of truth for AI settings so later command wiring can remain simple.

- [x] Add new config path constant(s) for `.libretto/config.json` in `core/context.ts`.
- [x] Add `core/ai-config.ts` to define Zod schema and types for:
- [x] Top-level config object with `version`.
- [x] `ai` object containing `preset`, `commandPrefix`, and `updatedAt`.
- [x] Add read/write helpers that validate schema and return actionable errors for invalid files.
- [x] Keep schema minimal and global (no profile/scope fields).
- [x] Success criteria: a unit-style helper test (or stateful CLI seed/load assertion) proves valid config parses and invalid shape throws a clear error that points to `.libretto/config.json`.

### Phase 2: Move configure/show/clear flow to AI config module

Move configuration behavior out of snapshot-specific code and into shared AI handlers. This keeps the command UX consistent while decoupling it from any single feature area.

- [x] Extract preset defaults and configure argument parsing from `snapshot-analyzer.ts` into shared AI config handlers.
- [x] Implement shared operations:
- [x] `show`: prints current AI config and file path.
- [x] `configure`: writes `ai` section with preset/custom command prefix and fresh `updatedAt`.
- [x] `clear`: removes only AI config state (either remove `ai` key or reset file to `{ version }`; choose one behavior and document it).
- [x] Ensure all user-facing output is AI terminology (not snapshot terminology).
- [x] Success criteria: configure/show/clear output references AI config only, and file writes occur at `.libretto/config.json`.

### Phase 3: Expose AI CLI command surface

Add a first-class `ai` command entry point so users configure model behavior in one obvious place. This phase is focused on discoverable CLI UX, not analyzer internals.

- [x] Add `ai configure [preset]` command in CLI registration with `--clear` and optional custom prefix via `--` separator.
- [x] Update root usage text/examples to show `libretto ai configure ...`.
- [x] Keep command behavior deterministic and aligned with existing configure UX semantics.
- [x] Decide whether to keep `snapshot configure` as temporary alias in this phase; if kept, ensure help text labels it as compatibility behavior.
- [x] Success criteria: `libretto ai configure codex`, bare `libretto ai configure` (show), and `--clear` all run successfully with expected stdout and exit code `0`.

### Phase 4: Rewire snapshot analyzer to shared AI config resolver

Switch snapshot analysis to consume the new shared AI config path and helpers. Behavior should remain functionally the same, with only configuration source and user guidance updated.

- [x] Replace snapshot-specific config reads in `snapshot-analyzer.ts` with shared AI config resolver calls.
- [x] Keep existing analyzer execution adapters (`codex`, `opencode`, `claude`, `gemini`) but source their command prefix from shared AI config.
- [x] Update missing-config and command-not-found error strings to point users to `libretto ai configure ...`.
- [x] Do not change prompt/schema generation logic for snapshot interpretation in this phase.
- [x] Success criteria: snapshot analysis still works when AI config exists and fails with actionable `ai configure` guidance when missing.

### Phase 5: Update tests and docs for new config contract

Finalize the contract by updating automated coverage and user documentation. This phase ensures the new AI config model is validated end-to-end and clearly documented.

- [x] Update `cli-stateful.test.ts` config tests from snapshot-specific command/path terminology to AI command/path terminology.
- [x] Update `test-fixtures.ts` seed helper to write `.libretto/config.json` with the new schema.
- [x] Update README section from “snapshot analyzer configuration” to generic “AI configuration”.
- [x] Run `pnpm --filter libretto test` and ensure all CLI tests pass with the new config path and messages.
- [x] Success criteria: test suite passes and docs/examples consistently reference `.libretto/config.json` and `ai configure`.
