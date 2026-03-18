## Problem overview

CLI argument handling is currently distributed across `cli.ts` and every command file. Each handler receives raw `argv`, repeatedly casts fields (`String(argv.session)`, `argv.foo as string | undefined`), and duplicates validation/defaulting logic. This makes the command surface harder to reason about and blocks router-style composition (typed input + reusable middleware) like oRPC.

The current bootstrap also does manual pre-parse behavior (`CLI_COMMANDS`, `filterSessionArgs`, `parseSessionForLog`) that keeps parser concerns and command concerns coupled.

## Solution overview

Introduce an internal CLI framework called `SimpleCLI` that models commands as typed procedures and groups:

- `SimpleCLI.define(name, router)` to register command routes.
- `SimpleCLI.command.input(...).use(middleware).handle(...)` to define each command.
- `SimpleCLI.group({ description?, routes })` to define subcommand groups such as `ai configure`.
- Reusable pre-handler logic is defined as plain functions typed with `SimpleCLIMiddleware<...>` and passed directly to `.use(...)`.
- `SimpleCLI.use(middleware).group({ description?, routes })` to apply middleware to a whole subcommand group.
- `SimpleCLI.use(...)` and scoped `.use(...)` are single-middleware calls in v1; compose multiple middleware via chaining.
- Command route identity is auto-derived from object keys (e.g. `ai.configure` => CLI path `ai configure`), not manually specified.
- Command input is declared once as `SimpleCLI.input({ positionals: [...], named: {...} })`, then reused for parser binding + Zod validation + typed handler input.
- `SimpleCLI.input(...)` is parse/validate only in v1; it does not provide an additional `.transform()` step.
- Help text is auto-generated from the most specific available route description plus parameter metadata; there is no separate help DSL.

Phase 1 already landed the route tree, typed input DSL, middleware pipeline, and a temporary parser adapter seam so this work could start without rewriting the parser at the same time. The next step is to fold parsing into `SimpleCLI` itself so route matching, help dispatch, positional/named argument parsing, and `--` passthrough handling all live in one framework-owned execution path.

In the steady state, `SimpleCLI` should own parsing end-to-end. Command definitions remain the only source of truth for route identity, descriptions, parameter metadata, middleware, and handlers. External parser adapters and yargs-specific registration should disappear from the public API.

In v1, framework output stays human-first. `SimpleCLI` will own rendering and stream behavior for human mode only. Machine-mode output (`--json`) is deferred.

## Goals

- Define commands in a router/procedure style that is structurally similar to oRPC.
- Support first-class subcommand groups with shared middleware (`const ai = SimpleCLI.use(aiMiddleware).group({ routes: { configure: ... } })`).
- Ensure each command is defined once in one module (route identity, description, input normalization, middleware, handler), with no duplicate command allowlists or secondary registration maps.
- Ensure each command's input is defined once in one place using `{ positionals, named }` (no separate positional map + separate Zod object that can drift).
- Auto-generate subcommand-scoped help from route descriptions and input metadata, with the most specific available description shown above usage.
- Eliminate raw `argv` plumbing from command handlers in `src/cli/commands/*`.
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
- No framework-owned typed handler result envelopes in v1; keep command output handling lightweight until real command migration shows a concrete need.
- No machine-mode (`--json`) output in v1.
- No built-in `--dry-run` framework behavior in v1.
- No mandatory failure-context middleware in v1.
- No extra input-shaping modifier on `SimpleCLI.input(...)`; any derived reshaping happens in handlers or middleware.

## Future work

- Expose the internal CLI procedure builder as a public package API if external integrations need to register custom commands.
- Add machine-mode output (`--json`) with command-level typed success/error payload schemas.
- Revisit framework-owned handler result envelopes only if we need stronger centralized rendering later; avoid requiring commands to return structured payload objects by default.
- Add command composition utilities for nested command groups (`ai configure`, future namespaces) with less boilerplate.
- Add optional framework-level `--dry-run` support for mutating commands.
- Add richer framework-provided failure context blocks when diagnostics quality needs to be improved.
- Standardize human-facing error formatting behind a framework-owned summary/recovery/help template only if command-specific error handling becomes too inconsistent to maintain.

## Important files/docs/websites for implementation

- `src/cli/cli.ts` - CLI bootstrap, usage output, and current framework execution path.
- `src/cli/commands/browser.ts` - `open/save/pages/close` handlers and browser-session flows.
- `src/cli/commands/execution.ts` - most complex command parsing (`run`, `exec`, `resume`), JSON/file/flag validation, and integration worker execution.
- `src/cli/commands/logs.ts` - `network/actions` command parsing and page/session option handling.
- `src/cli/commands/snapshot.ts` - `snapshot` parsing and connect-path behavior.
- `src/cli/commands/ai.ts` - multi-token command (`ai configure`) and passthrough `--` handling.
- `src/cli/commands/init.ts` - command migration coverage for non-session commands.
- `src/cli/commands/shared.ts` - shared `SimpleCLI` input helpers for session/page/numeric options.
- `src/cli/router.ts` - full `SimpleCLI` route tree used by the CLI bootstrap.
- `src/cli/core/session.ts` - session validation and state primitives used by session middleware.
- `src/cli/core/context.ts` - logger initialization and `.libretto` setup; impacted by session resolution timing.
- `src/cli/framework/simple-cli.ts` - framework primitives, built-in parser, alias handling, and help rendering surface.
- `test/fixtures.ts` - deterministic CLI subprocess harness and local `evaluate(...)` matcher rules.
- `test/simple-cli-framework.spec.ts` - focused framework tests for route derivation, parsing, middleware, aliases, and help behavior.
- `test/basic.spec.ts` - error/help/usage contracts for parser behavior.
- `test/stateful.spec.ts` - sessioned command behavior and command output contracts.
- `test/multi-page.spec.ts` - page-targeting behavior for connect-backed commands.
- `test/multi-session.spec.ts` - default-session and multi-session command behavior.
- `test/benchmark-run.spec.ts` - non-CLI benchmark helper regression coverage that must stay green under full `pnpm test`.
- [oRPC middleware](https://orpc.dev/docs/middleware) - procedure middleware pattern (`use` + pre/post handler execution).
- [oRPC router](https://orpc.dev/docs/router) - nested router composition model and middleware application patterns.
- [oRPC OpenAPI getting started](https://orpc.dev/docs/openapi/getting-started) - route + input/output builder style reference.

## Implementation

### Phase 1: Add SimpleCLI core primitives and temporary parser seam

- [x] Add a new internal module (e.g. `src/cli/framework/simple-cli.ts`) with:
- [x] `SimpleCLI.define(name, routes)` root definition helper.
- [x] `SimpleCLI.command` builder supporting `.input`, `.use`, and `.handle`.
- [x] `SimpleCLI.group` builder supporting nested groups and group-level middleware.
- [x] Export a reusable `SimpleCLIMiddleware` type for middleware functions passed directly to `.use(...)`.
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
    routes: {
      configure: SimpleCLI.command({
        description: "Configure AI runtime",
      })
        .input(aiConfigureInput)
        .handle(runAiConfigureCommand),
    },
  }),
});
```

### Phase 2: Replace the parser seam with a built-in SimpleCLI parser and auto-generated help

- [x] Replace the temporary parser adapter with an internal `SimpleCLI` parser that owns:
- [x] command path matching,
- [x] positional and named option parsing,
- [x] boolean flag parsing,
- [x] `--` passthrough collection,
- [x] `help`, `--help`, and `help <subcommand>` dispatch,
- [x] unknown command / unknown flag / missing value / missing required argument errors.
- [x] Generate help text from the command tree, route descriptions, and input parameter metadata:
- [x] root help stays high-level,
- [x] group help starts with the group description, then usage, then child commands,
- [x] command help starts with the command description, then usage, arguments, and options.
- [x] Ensure the most specific available description is shown for the requested help target.
- [x] Remove parser-adapter requirements from the public `SimpleCLI.run(...)` API.
- [x] Migrate one command group (`ai configure`) help to the new contract as a framework-level pilot in `simple-cli-framework.spec.ts`.
- [x] Success criteria: `test/simple-cli-framework.spec.ts` passes for help/parsing behavior, and `basic.spec.ts` help-related assertions pass.
- [x] Example target shape:

```ts
const app = SimpleCLI.define("libretto", {
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
// Usage: libretto ai configure [preset] [options]
//
// Arguments:
//   [preset]  AI preset
//
// Options:
//   --clear  Clear existing AI config
//   -- <args...>  Command prefix after --
```

### Phase 3: Add typed middleware context propagation

- [x] Make `SimpleCLIMiddleware` generic over middleware input and context in/out types.
- [x] Make command and scope builders accumulate middleware-provided context in handler types.
- [x] Treat middleware return values as the next full `ctx` object at runtime; the framework does not merge context patches.
- [x] Preserve current middleware ordering and runtime behavior while strengthening compile-time types for downstream middleware and handlers.
- [x] Add focused framework tests for typed context propagation and runtime context merging.
- [x] Keep framework-owned handler envelopes out of scope; command return values stay lightweight for now.
- [x] Success criteria: handlers can access middleware-provided context with strong types, and existing parsing/help tests continue to pass.
- [x] Example target shape:

```ts
const validateSession: SimpleCLIMiddleware<
  { session?: string },
  {},
  { sessionState: SessionState }
> = async ({ input }) => {
  const sessionState = await loadSessionState(input.session ?? "default");
  return { sessionState };
};

const sessioned = SimpleCLI.use(validateSession);

const app = SimpleCLI.define("libretto", {
  open: sessioned.command({
    description: "Launch browser and open URL (headed by default)",
  })
    .input(openInput)
    .handle(async ({ input, ctx }) => {
      await runOpen(input.url, ctx.sessionState);
    }),
});
```

### Phase 4: Migrate command input contracts to `{ positionals, named }`

- [x] Migrate `ai`, `init`, and one browser command (`open`) to `SimpleCLI.input(...)`.
- [x] Preserve existing validation/error text for mutually exclusive flags and missing required arguments.
- [x] Ensure handlers consume typed `input` and stop reading raw `argv`.
- [x] Use the migrated commands as the initial router-backed path in `cli.ts`; later phases can expand this to the full CLI router.
- [x] Success criteria: migrated commands pass existing tests; command modules no longer require handler-time casts for migrated commands.
- [x] Example target shape:

```ts
const openCommand = SimpleCLI.command({ description: "Launch browser and open URL (headed by default)" })
  .input(openInput)
  .handle(async ({ input }) => {
    await runOpen(input.url, !input.headless, input.session);
  });
```

### Phase 5: Add session middlewares and migrate sessioned commands

- [x] Implement shared session middlewares in `commands/shared.ts`:
- [x] `resolveSessionMiddleware` to normalize validated input into `ctx.session`,
- [x] `loadSessionStateMiddleware` for commands that must connect to an existing session (`save`, `exec`, `snapshot`, `network`, `actions`, `pages`, `resume`).
- [x] Keep non-session commands (`ai configure`, `init`, `help`) out of session middleware.
- [x] Preserve command-specific usage precedence by expressing single-command argument requirements in each command's input validation instead of introducing one-off middleware (`open`, `save`, `exec`, `run`).
- [x] Use middleware-provided `ctx.session` in sessioned handlers, and use `ctx.sessionState` where it materially removes a re-read (`resume`).
- [x] Keep `run`'s failed-session recovery/startability logic local to the handler, since that behavior is only used by `run` and does not need a separate middleware abstraction.
- [x] Success criteria: `pnpm type-check`, `basic.spec.ts`, `stateful.spec.ts`, and `multi-page.spec.ts` pass with the existing user-visible session behavior intact.
- [x] Example target shape:

```ts
const resolveSessionMiddleware: SimpleCLIMiddleware<
  { session: string },
  {},
  { session: string }
> = async ({ input, ctx }) => {
  return { ...ctx, session: input.session };
};

const loadSessionStateMiddleware: SimpleCLIMiddleware<
  { session: string },
  { session: string },
  { session: string; sessionState: SessionState }
> = async ({ ctx }) => {
  return {
    ...ctx,
    sessionState: readSessionStateOrThrow(ctx.session),
  };
};

const runInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("integrationFile", z.string().optional()),
    SimpleCLI.positional("integrationExport", z.string().optional()),
  ],
  named: {
    session: sessionOption(),
  },
})
  .refine(
    (input) => Boolean(input.integrationFile && input.integrationExport),
    "Usage: libretto run <integrationFile> <integrationExport> ...",
  );

const resumeCommand = SimpleCLI.command({
  description: "Resume a paused workflow for the current session",
})
  .input(resumeInput)
  .use(resolveSessionMiddleware)
  .use(loadSessionStateMiddleware)
  .handle(async ({ ctx }) => {
    await runResume(ctx.session, logger, ctx.sessionState);
  });
```

### Phase 6: Replace legacy CLI bootstrap parsing glue with router execution

- [x] Migrate the remaining CLI commands (`save`, `pages`, `close`, `exec`, `run`, `resume`, `snapshot`, `network`, `actions`) onto `SimpleCLI` command definitions so bootstrap execution can use a single parser/runtime path.
- [x] Refactor `cli.ts` to execute `SimpleCLI.define(...)` directly from `process.argv.slice(2)` with grouped namespaces (including `ai.configure`) rather than `register*Commands(...)` factories.
- [x] Remove `filterSessionArgs`, parser-adapter plumbing, and yargs-specific command registration entirely.
- [x] Keep top-level usage/help/unknown-command behavior stable (including `help`, `--help`, and unknown command flow).
- [x] Keep early `--session` validation and logger initialization routed from metadata derived from the router tree, so session logs still land under the expected session/default path on early failures.
- [x] Success criteria: `simple-cli-framework.spec.ts`, `basic.spec.ts`, `stateful.spec.ts`, and `multi-page.spec.ts` pass without output regressions; command lookup/registration originates only from the router tree.
- [x] Example target shape:

```ts
export async function runLibrettoCLI(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  ensureLibrettoSetup();
  await withCliLogger(rawArgs, async (logger) => {
    const app = createCLIApp(logger);
    await app.run(rawArgs);
  });
}
```

### Phase 7: Full regression verification and guardrail tests

- [x] Make the CLI regression suite self-contained so `pnpm test` does not depend on external LLM evaluation services or cloud-secret lookups.
- [x] Keep the `evaluate(...)` assertion API, but back it with deterministic local matcher rules in the CLI test harness instead of remote LLM evaluation.
- [x] Keep package-level CLI test execution deterministic by serializing file execution while subprocess-heavy suites are still sharing browser/process resources.
- [x] Add regression tests that assert middleware-driven command behavior for:
- [x] session defaulting and validation,
- [x] middleware ordering,
- [x] nested group command resolution (`ai configure`) and group-level middleware execution,
- [x] input contract behavior for `{ positionals, named }` (ordering, option aliases, defaults),
- [x] command-level input normalization errors.
- [x] Add tests for the current human CLI output contract:
- [x] success keeps primary results on stdout with no unexpected stderr noise for key happy-path commands,
- [x] deterministic ordering/field names for list and human-readable output.
- [x] Run `pnpm type-check`.
- [x] Run `pnpm test`.
- [x] Run `pnpm test -- test/basic.spec.ts`.
- [x] Run `pnpm test -- test/stateful.spec.ts`.
- [x] Run `pnpm test -- test/multi-page.spec.ts`.
- [x] Run `pnpm test -- test/multi-session.spec.ts`.
- [x] Success criteria: all targeted tests pass, the full current test suite passes, and command output contracts remain unchanged.
- [x] Example guardrails now live in `test/simple-cli-framework.spec.ts`, `test/stateful.spec.ts`, and `test/multi-page.spec.ts`, covering middleware ordering, scoped group resolution, default-session behavior, and deterministic human-readable output.

```ts
test("group middleware runs before ai configure handler", async () => {
  const result = await librettoCli("ai configure codex");
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("AI config saved.");
  expect(readLastCliLog()).toContain("ai-middleware-enter");
});
```
