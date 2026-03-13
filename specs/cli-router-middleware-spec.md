## Problem overview

CLI argument handling is currently distributed across `cli.ts` and every command file. Each handler receives raw `argv`, repeatedly casts fields (`String(argv.session)`, `argv.foo as string | undefined`), and duplicates validation/defaulting logic. This makes the command surface harder to reason about and blocks router-style composition (typed input + reusable middleware) like oRPC.

The current bootstrap also does manual pre-parse behavior (`CLI_COMMANDS`, `filterSessionArgs`, `parseSessionForLog`) that keeps parser concerns and command concerns coupled.

## Solution overview

Introduce an internal CLI framework called `SimpleCLI` that models commands as typed procedures and groups:

- `SimpleCLI.define(name, router)` to register command routes.
- `SimpleCLI.command.input(...).use(...).handle(...)` to define each command.
- `SimpleCLI.group({...})` to define subcommand groups such as `ai configure`.
- `SimpleCLI.middleware(...)` for reusable pre-handler logic.
- `SimpleCLI.use(middleware).group({...})` to apply middleware to a whole subcommand group.
- Command route identity is auto-derived from object keys (e.g. `ai.configure` => CLI path `ai configure`), not manually specified.
- Command input is declared once as `SimpleCLI.input({ positionals: [...], named: {...} })`, then reused for parser binding + Zod validation + typed handler input.
- `SimpleCLI.input(...)` is parse/validate only in v1; it does not provide an additional `.transform()` step.
- Help text is auto-generated from the most specific available route description plus parameter metadata; there is no separate help DSL.

Phase 1 already landed the route tree, typed input DSL, middleware pipeline, and a temporary parser adapter seam so this work could start without rewriting the parser at the same time. The next step is to fold parsing into `SimpleCLI` itself so route matching, help dispatch, positional/named argument parsing, and `--` passthrough handling all live in one framework-owned execution path.

In the steady state, `SimpleCLI` should own parsing end-to-end. Command definitions remain the only source of truth for route identity, descriptions, parameter metadata, middleware, and handlers. External parser adapters and yargs-specific registration should disappear from the public API.

In v1, framework output stays human-first. `SimpleCLI` will own rendering and stream behavior for human mode only. Machine-mode output (`--json`) is deferred.

## Goals

- Define commands in a router/procedure style that is structurally similar to oRPC.
- Support first-class subcommand groups with shared middleware (`const ai = SimpleCLI.use(aiMiddleware).group({ configure: ... })`).
- Ensure each command is defined once in one module (route identity, description, input normalization, middleware, handler), with no duplicate command allowlists or secondary registration maps.
- Ensure each command's input is defined once in one place using `{ positionals, named }` (no separate positional map + separate Zod object that can drift).
- Auto-generate subcommand-scoped help from route descriptions and input metadata, with the most specific available description shown above usage.
- Eliminate raw `argv` plumbing from command handlers in `packages/libretto/src/cli/commands/*`.
- Make `SimpleCLI` the owner of command token parsing, route matching, `help`/`--help`, and `--` passthrough handling.
- Support reusable middleware that runs after parsing/input normalization and before handlers.
- Centralize session-related pre-handler logic in dedicated middleware used by `open`/`run` and commands that connect to an existing session.
- Enforce deterministic output and stream conventions by default (`stdout` for result payloads, `stderr` for diagnostics/help/recovery).
- Keep user-facing API minimal in v1 while enforcing the above via framework defaults.
- Preserve existing user-facing behavior (usage strings, error contracts, exit codes, session defaults).

## Non-goals

- No migrations or backfills.
- No behavior redesign of browser/runtime primitives (`runOpen`, `runIntegrationFromFile`, `connect`, etc.).
- No command UX copy rewrite beyond what is required to preserve current output contracts.
- No plugin system or third-party extension API for CLI middleware in v1.
- No manual per-command path strings in command definitions; route paths are derived from router/group keys.
- No free-form/unstructured error printing from handlers; handlers return typed error/result objects and framework owns final rendering.
- No machine-mode (`--json`) output in v1.
- No built-in `--dry-run` framework behavior in v1.
- No mandatory failure-context middleware in v1.
- No extra input-shaping modifier on `SimpleCLI.input(...)`; any derived reshaping happens in handlers or middleware.

## Future work

- Expose the internal CLI procedure builder as a public package API if external integrations need to register custom commands.
- Add machine-mode output (`--json`) with command-level typed success/error payload schemas.
- Add command composition utilities for nested command groups (`ai configure`, future namespaces) with less boilerplate.
- Add optional framework-level `--dry-run` support for mutating commands.
- Add richer framework-provided failure context blocks when diagnostics quality needs to be improved.

## Important files/docs/websites for implementation

- `packages/libretto/src/cli/cli.ts` - CLI bootstrap, parser construction, usage output, and current manual pre-parse handling.
- `packages/libretto/src/cli/commands/browser.ts` - `open/save/pages/close` handlers currently coupled to raw argv.
- `packages/libretto/src/cli/commands/execution.ts` - most complex command parsing (`run`, `exec`, `resume`), JSON/file/flag validation.
- `packages/libretto/src/cli/commands/logs.ts` - `network/actions` command parsing and page/session option handling.
- `packages/libretto/src/cli/commands/snapshot.ts` - `snapshot` parsing and connect-path behavior.
- `packages/libretto/src/cli/commands/ai.ts` - multi-token command (`ai configure`) and passthrough `--` handling.
- `packages/libretto/src/cli/commands/init.ts` - command migration coverage for non-session commands.
- `packages/libretto/src/cli/core/session.ts` - session validation and state primitives used by session middleware.
- `packages/libretto/src/cli/core/context.ts` - logger initialization and `.libretto` setup; impacted by session resolution timing.
- `packages/libretto/src/cli/framework/simple-cli.ts` - framework primitives, future built-in parser, and help rendering surface.
- `packages/libretto/test/simple-cli-framework.spec.ts` - focused framework tests for route derivation, parsing, middleware, and help behavior.
- `packages/libretto/test/basic.spec.ts` - error/help/usage contracts for parser behavior.
- `packages/libretto/test/stateful.spec.ts` - sessioned command behavior and command output contracts.
- `packages/libretto/test/multi-page.spec.ts` - page-targeting behavior for connect-backed commands.
- [oRPC middleware](https://orpc.dev/docs/middleware) - procedure middleware pattern (`use` + pre/post handler execution).
- [oRPC router](https://orpc.dev/docs/router) - nested router composition model and middleware application patterns.
- [oRPC OpenAPI getting started](https://orpc.dev/docs/openapi/getting-started) - route + input/output builder style reference.

## Implementation

### Phase 1: Add SimpleCLI core primitives and temporary parser seam

- [x] Add a new internal module (e.g. `packages/libretto/src/cli/framework/simple-cli.ts`) with:
- [x] `SimpleCLI.define(name, routes)` root definition helper.
- [x] `SimpleCLI.command` builder supporting `.input`, `.use`, and `.handle`.
- [x] `SimpleCLI.group` builder supporting nested groups and group-level middleware.
- [x] `SimpleCLI.middleware` helper type for reusable middleware functions.
- [x] `SimpleCLI.input({ positionals, named })` DSL with `SimpleCLI.positional`, `SimpleCLI.option`, and `SimpleCLI.flag`.
- [x] Land an initial command config shape and route metadata model; Phase 2 will simplify this to description-driven help generation.
- [x] Add a temporary parser adapter interface so routing/input work can land before parser ownership moves into `SimpleCLI`.
- [x] Auto-derive command route metadata from router keys (`routeKey`, CLI tokens) and expose it to middleware/handlers.
- [x] Auto-derive parser bindings and canonical Zod object schema from each command input definition.
- [x] Implement deterministic middleware execution order (definition order) before handler invocation.
- [x] Keep parser concerns outside the framework only in this phase as scaffolding for the rest of the migration.
- [x] Ensure router entries are the sole command source-of-truth consumed by parser registration (no manual command name set in bootstrap).
- [x] Success criteria: focused tests prove route derivation, input parsing, and middleware ordering work independently of concrete command modules.
- [x] Example target shape:

```ts
const openInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("url", z.string().url(), {
      help: "URL to open",
    }),
  ],
  named: {
    session: SimpleCLI.option(SessionNameSchema.default("default"), {
      help: "Use a named session",
    }),
    headed: SimpleCLI.flag({ help: "Run browser in headed mode" }),
    headless: SimpleCLI.flag({ help: "Run browser in headless mode" }),
  },
}).refine((v) => !(v.headed && v.headless), "Cannot pass both --headed and --headless.");

const aiConfigureInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("preset", z.enum(["codex", "claude", "gemini"]).optional(), {
      help: "AI preset",
    }),
  ],
  named: {
    clear: SimpleCLI.flag({ help: "Clear existing AI config" }),
    passthrough: SimpleCLI.option(z.array(z.string()).default([]), {
      source: "--",
      help: "Custom command prefix after --",
    }),
  },
});

const app = SimpleCLI.define("libretto", {
  open: SimpleCLI.command({
    description: "Launch browser and open URL (headed by default)",
  })
    .input(openInput)
    .use(autocreateSessionMiddleware)
    .handle(runOpenCommand),
  ai: SimpleCLI.use(aiMiddleware).group({
    configure: SimpleCLI.command({
      description: "Configure AI runtime",
    })
      .input(aiConfigureInput)
      .handle(runAiConfigureCommand),
  }),
});
```

### Phase 2: Replace the parser seam with a built-in SimpleCLI parser and auto-generated help

- [ ] Replace the temporary parser adapter with an internal `SimpleCLI` parser that owns:
- [ ] command path matching,
- [ ] positional and named option parsing,
- [ ] boolean flag parsing,
- [ ] `--` passthrough collection,
- [ ] `help`, `--help`, and `help <subcommand>` dispatch,
- [ ] unknown command / unknown flag / missing value / missing required argument errors.
- [ ] Generate help text from the command tree, route descriptions, and input parameter metadata:
- [ ] root help stays high-level,
- [ ] group help starts with the group description, then usage, then child commands,
- [ ] command help starts with the command description, then usage, arguments, and options.
- [ ] Ensure the most specific available description is shown for the requested help target.
- [ ] Remove parser-adapter requirements from the public `SimpleCLI.run(...)` API.
- [ ] Migrate one command group (`ai configure`) help to the new contract as a pilot.
- [ ] Success criteria: `packages/libretto/test/simple-cli-framework.spec.ts` passes for help/parsing behavior, and `basic.spec.ts` help-related assertions pass.
- [ ] Example target shape:

```ts
const app = SimpleCLI.define("libretto-cli", {
  ai: SimpleCLI.group({
    description: "AI commands",
    routes: {
      configure: SimpleCLI.command({
        description: "Configure AI runtime",
      })
        .input(aiConfigureInput)
        .handle(runAiConfigureCommand),
    },
  }),
});

await app.run(["help", "ai", "configure"]);
// =>
// Configure AI runtime
//
// Usage: libretto-cli ai configure [preset] [options]
//
// Arguments:
//   [preset]  AI preset
//
// Options:
//   --clear  Clear existing AI config
//   -- <args...>  Command prefix after --
```

### Phase 3: Add centralized human renderer and handler result contract

- [ ] Define `SimpleCLI` handler return envelope for human mode (success/error + next-step/no-further-action markers).
- [ ] Add centralized human renderer in `SimpleCLI`:
- [ ] success primary output on `stdout`,
- [ ] diagnostics/recovery/help hints on `stderr`,
- [ ] deterministic wording and ordering.
- [ ] Migrate one command (`ai configure`) to return envelope and render through framework.
- [ ] Success criteria: renderer tests pass and `ai configure` output remains compatible with existing stateful tests.
- [ ] Example target shape:

```ts
return {
  ok: false,
  error: "Invalid JSON in --params",
  recovery: [
    "Pass valid JSON to --params.",
    "Or use --params-file <path> with a valid JSON file.",
  ],
  helpHint: "libretto-cli help run",
};
```

### Phase 4: Migrate command input contracts to `{ positionals, named }`

- [ ] Migrate `ai`, `init`, and one browser command (`open`) to `SimpleCLI.input(...)`.
- [ ] Preserve existing validation/error text for mutually exclusive flags and missing required arguments.
- [ ] Ensure handlers consume typed `input` and stop reading raw `argv`.
- [ ] Success criteria: migrated commands pass existing tests; command modules no longer require handler-time casts for migrated commands.
- [ ] Example target shape:

```ts
type OpenInput = SimpleCLI.InferInput<typeof openInput>;

const openCommand = SimpleCLI.command({ description: "Launch browser and open URL (headed by default)" })
  .input(openInput)
  .handle(async ({ input, logger }) => {
    await runOpen(input.url, !input.headless, input.session, logger);
    return { ok: true, message: `Browser open: ${input.url}` };
  });
```

### Phase 5: Add session middlewares and migrate sessioned commands

- [ ] Implement `autocreateSessionMiddleware` and `sessionSetupMiddleware`.
- [ ] Apply these middlewares to `open`/`run` and connect-backed commands (`save`, `exec`, `snapshot`, `network`, `actions`, `pages`, `resume`).
- [ ] Keep non-session commands (`ai configure`, `init`, `help`) out of session middleware.
- [ ] Success criteria: existing session-related failures in integration tests keep current user-visible behavior.
- [ ] Example target shape:

```ts
const autocreateSessionMiddleware = SimpleCLI.middleware(async ({ input, ctx }) => {
  const session = input.session ?? "default";
  validateSessionName(session);
  return { ...ctx, session };
});

const sessionSetupMiddleware = SimpleCLI.middleware(async ({ ctx, command }) => {
  if (command.routeKey === "open" || command.routeKey === "run") {
    assertSessionAvailableForStart(ctx.session);
    return ctx;
  }
  readSessionStateOrThrow(ctx.session);
  return ctx;
});
```

### Phase 6: Replace legacy CLI bootstrap parsing glue with router execution

- [ ] Refactor `cli.ts` to execute `SimpleCLI.define(...)` directly from `process.argv.slice(2)` with grouped namespaces (including `ai.configure`) rather than `register*Commands(...)` factories.
- [ ] Remove `filterSessionArgs`, parser-adapter plumbing, and command-token allowlists that duplicate parser responsibilities.
- [ ] Keep top-level usage/help/unknown-command behavior stable (including `help`, `--help`, and unknown command flow).
- [ ] Ensure logger initialization still works on early failures and writes to the expected session/default log path.
- [ ] Success criteria: help/unknown/invalid-session tests in `basic.spec.ts` pass without output regressions, and command lookup/registration originates only from the router tree.
- [ ] Example target shape:

```ts
export async function runLibrettoCLI(): Promise<void> {
  ensureLibrettoSetup();
  const app = buildLibrettoSimpleCLI();
  await app.run(process.argv.slice(2));
}
```

### Phase 7: Full regression verification and guardrail tests

- [ ] Add regression tests that assert middleware-driven command behavior for:
- [ ] session defaulting and validation,
- [ ] middleware ordering,
- [ ] nested group command resolution (`ai configure`) and group-level middleware execution,
- [ ] input contract behavior for `{ positionals, named }` (ordering, option aliases, defaults),
- [ ] command-level input normalization errors.
- [ ] Add tests for CLI-development stream/output contract:
- [ ] success writes primary result to stdout and diagnostics to stderr,
- [ ] argument/runtime errors include summary + known state + recovery + next command + help hint,
- [ ] deterministic ordering/field names for list and human-readable output.
- [ ] Run `pnpm --filter libretto type-check`.
- [ ] Run `pnpm --filter libretto test -- test/basic.spec.ts`.
- [ ] Run `pnpm --filter libretto test -- test/stateful.spec.ts`.
- [ ] Run `pnpm --filter libretto test -- test/multi-page.spec.ts`.
- [ ] Success criteria: all targeted tests pass and command output contracts remain unchanged.
- [ ] Example guardrail:

```ts
test("group middleware runs before ai configure handler", async () => {
  const result = await librettoCli("ai configure codex");
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("AI config saved.");
  expect(readLastCliLog()).toContain("ai-middleware-enter");
});
```
