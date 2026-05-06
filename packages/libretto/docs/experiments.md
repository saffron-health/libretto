# Experiments Framework

Use this reference when adding or changing Libretto experiment flags, wiring experiment checks through CLI or daemon internals, or debugging `libretto experiments` behavior.

## Purpose and Scope

Experiments are boolean feature flags for Libretto internal machinery. They let maintainers enable in-progress CLI or daemon behavior in a workspace without exposing those flags to user workflow code.

Do not add experiments to `LibrettoWorkflowContext` in `packages/libretto/src/shared/workflow/workflow.ts`. User workflows should not branch on Libretto experiment flags.

## Registry and Workspace State

The experiment registry lives in `packages/libretto/src/cli/core/experiments.ts`.

- Add each flag to `EXPERIMENTS` with a stable hyphenated slug, title, description, and `defaultValue`.
- Use the exported `ExperimentName` and `Experiments` types instead of duplicating flag shapes.
- Use `resolveExperiments()` to read the resolved boolean snapshot.
- Use `setExperimentEnabled()` to persist an override and reject unknown flag names.

Workspace overrides are stored in `.libretto/config.json` under the optional `experiments` record. The config schema is defined in `packages/libretto/src/cli/core/config.ts`; unknown config fields are still passed through.

Example workspace state:

```json
{
  "version": 1,
  "experiments": {
    "compact-snapshot-format": true
  }
}
```

## CLI Behavior

`libretto experiments` is the CLI surface for inspecting and changing workspace experiment overrides.

```bash
npx libretto experiments
npx libretto experiments describe <experiment>
npx libretto experiments enable <experiment>
npx libretto experiments disable <experiment>
```

The command is implemented in `packages/libretto/src/cli/commands/experiments.ts` and registered as a top-level command. Listing prints registered experiments in registry order with their enabled/disabled state and description. `describe` prints the experiment status and full instructions. `enable` persists the override to `.libretto/config.json` and prints the full description with a prelude that the enabled experiment changes expected Libretto usage from the skill. `disable` persists the override and prints deterministic success text.

Invalid actions, missing experiment names, and unknown experiment names should fail with actionable usage that includes the available experiment names.

## CLI and Daemon Plumbing

Use `withExperiments()` from `packages/libretto/src/cli/commands/shared.ts` when a command needs experiment values. It resolves one experiment snapshot for the CLI invocation and adds it to command context as `ctx.experiments`.

Daemon-backed startup paths must serialize that snapshot into `DaemonConfig.experiments` in `packages/libretto/src/cli/core/daemon/config.ts`. This currently applies to:

- daemon-backed `open`
- `connect`
- provider-backed `open`
- `run`

The daemon receives experiments at startup only. Changes made with `libretto experiments enable|disable` apply to new daemon sessions, not already-running sessions.

Inside the daemon, experiments are for Libretto machinery only. Keep them in daemon/controller internals; do not pass them into public workflow context objects.

## Testing Notes

Before adding or changing tests, read `docs/tests-guide.md`.

Prefer user-level CLI behavior tests for `libretto experiments` listing and enable/disable flows. Keep a regression test that an enabled experiment is not visible on `LibrettoWorkflowContext` during `run`.
