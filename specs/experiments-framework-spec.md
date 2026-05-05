## Problem overview

Libretto needs a small experiments framework for feature flags. Users should be able to see known experiments, enable or disable them in workspace state, and have CLI and daemon code receive the resolved flag values.

## Solution overview

Add a typed experiment registry and store per-workspace flag overrides in `.libretto/config.json`. Add a top-level `libretto experiments` command that lists registered experiments and supports `enable` and `disable` actions, then add CLI middleware that reads the resolved experiment map and passes the same snapshot into daemon startup config for new sessions.

## Goals

- Users can run `npx libretto experiments` to list every registered experiment and its enabled or disabled state.
- Users can run `npx libretto experiments enable <experiment>` and `npx libretto experiments disable <experiment>` to persist a flag override in Libretto workspace state.
- CLI command handlers can read a typed experiments object from middleware as `{ [experimentName]: boolean }`.
- Daemon-backed flows receive the same resolved experiments object at daemon startup.

## Non-goals

- No migrations or backfills.
- No remote experiment service, targeting rules, percentages, variants, or non-boolean values.
- No live propagation of experiment changes into already-running daemon sessions.
- No public documentation page beyond CLI help and command output in v1.

## Future work

No future work yet.

## Important files/docs/websites for implementation

- `packages/libretto/src/cli/core/config.ts` — Defines the workspace `.libretto/config.json` schema and read/write helpers.
- `packages/libretto/src/cli/core/context.ts` — Defines the Libretto config path and setup directory helpers.
- `packages/libretto/src/cli/router.ts` — Registers top-level SimpleCLI command routes.
- `packages/libretto/src/cli/commands/shared.ts` — Holds reusable CLI options and middleware; this is the natural place for `withExperiments()`.
- `packages/libretto/src/cli/commands/browser.ts` — Starts daemon-backed `open` and `connect` sessions.
- `packages/libretto/src/cli/commands/execution.ts` — Starts daemon-backed `run` workflows and should pass experiments into daemon config.
- `packages/libretto/src/cli/core/daemon/config.ts` — Defines serialized daemon startup config.
- `packages/libretto/src/cli/core/daemon/daemon.ts` — Reads daemon config and starts browser/workflow controllers.
- `packages/libretto/src/cli/core/workflow-runner/runner.ts` — Builds the workflow context passed to user workflows.
- `packages/libretto/src/shared/workflow/workflow.ts` — Defines the public `LibrettoWorkflowContext` type.
- `packages/libretto/test/basic.spec.ts` — Existing user-level CLI help and behavior tests.
- `docs/tests-guide.md` — Test guidance: prefer user-level CLI behavior assertions and avoid testing internal `.libretto` file structure.

## Implementation

### Phase 1: Add a typed experiment registry and config helpers

Define the flag data model first so commands, middleware, and daemon config share one source of truth. Keep v1 to boolean flags and use a static registry so `libretto experiments` can list all known experiments deterministically.

```ts
export const EXPERIMENTS = {
  exampleExperiment: {
    title: "Example experiment",
    description: "Short user-facing description",
    defaultValue: false,
  },
} as const;

export type ExperimentName = keyof typeof EXPERIMENTS;
export type Experiments = Record<ExperimentName, boolean>;

export function resolveExperiments(config = readLibrettoConfig()): Experiments {
  return Object.fromEntries(
    Object.entries(EXPERIMENTS).map(([name, metadata]) => [
      name,
      config.experiments?.[name] ?? metadata.defaultValue,
    ]),
  ) as Experiments;
}
```

- [x] Add `packages/libretto/src/cli/core/experiments.ts` with `EXPERIMENTS`, `ExperimentName`, `Experiments`, `isExperimentName`, `resolveExperiments`, and `setExperimentEnabled`; registered experiment metadata includes title, description, and default value.
- [x] Extend `LibrettoConfigSchema` in `packages/libretto/src/cli/core/config.ts` with optional `experiments: z.record(z.boolean()).optional()` while preserving passthrough behavior.
- [x] Make `setExperimentEnabled` reject unknown experiment names using the static registry.
- [x] Skip experiment-specific unit coverage for Phase 1 per user request.
- [x] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 2: Add the `libretto experiments` CLI command

Add the user-facing command after the core helpers exist. Use one top-level command with optional action positionals so `libretto experiments` lists experiments directly instead of showing group help.

```ts
const experimentsInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("action", z.enum(["enable", "disable"]).optional()),
    SimpleCLI.positional("experiment", z.string().optional()),
  ],
  named: {},
});

export const experimentsCommand = SimpleCLI.command({
  description: "List or update Libretto experiment flags",
})
  .input(experimentsInput)
  .handle(async ({ input }) => {
    if (!input.action) return printExperiments(resolveExperiments());
    setExperimentEnabled(input.experiment, input.action === "enable");
  });
```

- [x] Add `packages/libretto/src/cli/commands/experiments.ts` with list, enable, and disable behavior.
- [x] Register `experiments: experimentsCommand` in `packages/libretto/src/cli/router.ts`.
- [x] Make `libretto experiments` print each registered experiment in stable registry order with its state and description.
- [x] Make enable/disable output deterministic success text, for example `Experiment "x" enabled.`.
- [x] Make missing or unknown experiment names fail with actionable usage that includes `libretto experiments` and `libretto experiments enable <experiment>`.
- [x] Add user-level CLI tests in `packages/libretto/test/basic.spec.ts` for help visibility, listing, enabling, disabling, and unknown experiment failure.
- [x] Verify `pnpm -s test --filter=libretto -- basic.spec.ts` passes.

### Phase 3: Add experiments middleware to CLI context

Expose resolved flags through reusable middleware so future CLI handlers do not need to read config directly. Keep the middleware simple: read workspace config once for the command invocation and add `ctx.experiments`.

```ts
export type ExperimentsContext = {
  experiments: Experiments;
};

export function withExperiments(): SimpleCLIMiddleware<
  {},
  {},
  ExperimentsContext
> {
  return async ({ ctx }) => ({
    ...ctx,
    experiments: resolveExperiments(),
  });
}
```

- [x] Add `ExperimentsContext` and `withExperiments()` to `packages/libretto/src/cli/commands/shared.ts`.
- [x] Apply `withExperiments()` to daemon-starting commands that need to forward flags, starting with `open`, `connect`, and `run`.
- [x] Thread the resolved `ctx.experiments` value through existing command-to-core calls with the smallest signature changes.
- [x] Verify the real `open`, `connect`, and `run` handlers type-check when reading `ctx.experiments` as a boolean map.
- [x] Verify `pnpm -s type-check --filter=libretto` passes.

### Phase 4: Pass experiments into daemon startup and workflow context

Serialize the resolved experiment snapshot in `DaemonConfig` so new daemon sessions receive the same flags as the CLI invocation that created them. Expose the snapshot on workflow context so daemon-hosted workflows can branch on flags.

```ts
export type DaemonConfig = {
  session: string;
  experiments: Experiments;
  browser:
    | DaemonBrowserLaunchConfig
    | DaemonBrowserConnectConfig
    | DaemonBrowserProviderConfig;
  workflow?: DaemonWorkflowConfig;
};

const workflowContext: LibrettoWorkflowContext = {
  session: this.config.session,
  page: this.config.page,
  experiments: this.config.experiments,
};
```

- [ ] Add `experiments: Experiments` to `DaemonConfig` in `packages/libretto/src/cli/core/daemon/config.ts`.
- [ ] Pass experiments in every `DaemonClient.spawn({ config })` call used by `open`, `connect`, provider-backed open, and `run`.
- [ ] Store experiments on `BrowserDaemon` or `WorkflowControllerConfig`, whichever creates the smallest path to workflow context.
- [ ] Extend `LibrettoWorkflowContext` in `packages/libretto/src/shared/workflow/workflow.ts` with `experiments: Experiments`.
- [ ] Add a daemon/workflow test that enables a registered experiment, runs a workflow, and asserts the workflow can observe `ctx.experiments[experimentName] === true`.
- [ ] Verify `pnpm -s test --filter=libretto` passes.
