## Problem overview

Affordance v1 exposes CLI construction through `SimpleCLI`. Its middleware model is a pre-handler context builder: middleware receives `{ input, ctx, command }`, returns a replacement context, and then the handler runs after all middleware completes.

That model cannot express cross-cutting behavior that needs to wrap command execution, such as telemetry, timing, cleanup, tracing, or centralized error observation. Adding those semantics directly to `SimpleCLI` also keeps us tied to a builder shape that already has confusing inheritance behavior, such as deduplicating middleware when a scoped builder is reused.

## Solution overview

Build Aff v2 from scratch under `packages/affordance/src/v2/`. Do not retrofit `SimpleCLI` v1 during the v2 build. The v2 API is named `Aff`, uses bottom-up route builders, and composes middleware structurally through CLI, group, and command builders.

Tests live under `packages/affordance/test/v2/`. Rebuild the test suite from scratch, copying only v1 behavior that v2 intentionally preserves. Each phase should start by adding or adjusting red tests for that phase, then implement the smallest code needed to pass them.

The first implementation milestone should not try to match all v1 behavior. Start with route construction and invocation, then add help rendering, input parsing, runtime middleware, type contracts, and Libretto migration in separate phases.

## Goals

- Aff v2 exists separately from `SimpleCLI` v1.
- V2 APIs are exposed as `Aff`, not `SimpleCLI`.
- V2 uses bottom-up builders: middleware, commands, and groups are standalone values that are layered together structurally.
- Route resolution applies parent middleware structurally; commands do not pre-carry inherited group middleware.
- Middleware wraps downstream execution with `next()` and can run before and after the handler.
- Middleware can observe command success and failure without modifying every command handler.
- Middleware can inject or refine downstream context through `next({ ctx })`.
- `next()` rejects when downstream middleware or the handler throws, unless an intermediate middleware catches and handles the error.
- Command handlers receive `{ input, ctx, command }`.
- Input schemas can come from any validator that implements Standard Schema, while Zod remains valid because Zod v4 implements that interface.
- Root middleware can be installed once on the CLI root builder and applies to every resolved command.
- Tests are focused by behavior instead of growing one catch-all test file.

## Non-goals

- No changes to `packages/affordance/src/index.ts` during the v2 build phases.
- No migration of existing Libretto command handlers until the v2 API is stable.
- No replacement of the package root export until a later migration phase.
- No backwards compatibility for old v1 middleware semantics inside v2.
- No middleware inheritance deduplication helper like `mergeInheritedMiddlewares`; v2 should not need it.
- No public plugin registry.
- No input mapping API like oRPC's `.mapInput(...)` in the initial v2 build.
- No built-in lifecycle helpers such as `onStart`, `onSuccess`, `onError`, or `onFinish` in the initial v2 build.
- No handler output envelope; command handlers can return any value.
- No rename from `ctx` to `context` across Libretto command handlers.

## V2 API shape

Use bottom-up builders. Middleware, commands, and groups are standalone values; behavior such as telemetry is layered onto a CLI root.

```ts
const telemetry = Aff.middleware({ description: "telemetry" }).handle(
  async ({ command, next }) => {
    try {
      const result = await next();
      record(command, false);
      return result;
    } catch (error) {
      record(command, true);
      throw error;
    }
  },
);

const app = Aff.cli("libretto")
  .use(telemetry)
  .routes({
    cloud: Aff.group({ description: "Cloud commands" })
      .use(cloudMiddleware)
      .routes({
        login: Aff.command({ description: "Log in" })
          .arguments([])
          .options({
            session: z.string().optional(),
          })
          .use(commandMiddleware)
          .handle(async ({ ctx, input, command }) => {
            return "ok";
          }),
      }),
  });
```

Builder rules:

- `Aff.cli(name).use(...).routes(...)` creates an app.
- `Aff.group(config).use(...).routes(...)` creates a group.
- `Aff.command(config).arguments(...).options(...).use(...).handle(...)` creates a command with input.
- Commands without input can omit `.arguments(...)` and `.options(...)`.
- `.arguments(args)` declares positional arguments as an ordered array of `[name, schema]` tuples.
- `.options(options)` declares named options as an object of option schemas.
- Plain zod schemas are valid options.
- `Aff.option(schema)` wraps a valued option when option-specific metadata or behavior is needed.
- `Aff.flag(config?)` declares a boolean flag with a default of `false`.
- `Aff.middleware(fn)` is a typed identity helper for inline middleware.
- `Aff.middleware(config).handle(fn)` creates described middleware.
- Apps expose `app.exec(commandLine)` for command-line execution, where `commandLine` is a single string such as `"open https://example.com --session debug"`.
- Apps may expose `app.invoke(routeKey, args?, options?, initialContext?)` for direct programmatic invocation in tests and internal integrations.
- `.handle()` is terminal for commands and middleware.
- Commands do not inherit group middleware at construction time.
- Route resolution applies middleware in structural order: root, outer group, inner group, command.

## Runtime middleware semantics

Aff v2 middleware follows these rules:

- Middleware signature is `async ({ input, ctx, command, next }) => { ... }`.
- Calling `await next()` continues to the next middleware, or the command handler if there is no later middleware.
- Calling `await next({ ctx: patch })` shallow-merges `patch` into the current context for downstream execution.
- Root middleware runs after route matching and input parsing, before group and command middleware.
- Root middleware does not run for help output, version output handled outside Aff, exact group help, unknown commands, parse errors before command resolution, or input validation failures.
- The context visible after `await next(...)` is not automatically mutated for the current middleware; middleware that needs a local value should keep a local variable.
- If middleware returns without calling `next()`, it short-circuits downstream execution and its return value becomes the command result.
- If downstream execution throws, `next()` rejects with the same error object.
- If middleware catches the error and rethrows it, the CLI sees the original failure.
- If middleware catches the error and returns a value, the command is considered handled successfully from the caller's perspective.

## Test organization

Do not continue growing `packages/affordance/test/affordance.spec.ts`. Build v2 tests under `packages/affordance/test/v2/`.

Use these files:

- `packages/affordance/test/v2/routes-and-help.spec.ts` - route key/path derivation, groups, root/group/command help, unknown-command help recovery, and appended root help.
- `packages/affordance/test/v2/input.spec.ts` - argument/option parsing, passthrough handling, aliases, global options, defaults, variadic arguments, and input validation errors.
- `packages/affordance/test/v2/middleware.spec.ts` - runtime middleware behavior: ordering, `next()`, short-circuiting, error propagation, root/group/command middleware nesting, and telemetry-facing command metadata.
- `packages/affordance/test/v2/middleware-types.spec.ts` - type-level middleware contracts: context injection, downstream context availability, invalid context access via `@ts-expect-error`, and `$input` / `$context` builder contracts.

Copy v1 tests only when the behavior is an explicit v2 goal. Prefer fewer, clearer tests over a one-for-one port of the old suite.

## Implementation plan

Use TDD for every phase. Each phase should first add or update tests that fail for the expected reason, then implement only the smallest code needed for that phase. Do not implement later-phase behavior early unless it is required to make the current phase coherent.

### Phase 1: Establish the v2 test contract

Create the v2 test folder and write the initial red tests. This phase is intentionally test-only. It should fail because `packages/affordance/src/v2/index.ts` does not exist yet.

- [x] Add `packages/affordance/test/v2/routes-and-help.spec.ts` with focused route builder and help expectations.
- [x] Add `packages/affordance/test/v2/input.spec.ts` with minimum input expectations needed by route invocation.
- [x] Add `packages/affordance/test/v2/middleware.spec.ts` with runtime `next()` expectations.
- [ ] Add `packages/affordance/test/v2/middleware-types.spec.ts` with initial type-contract expectations, or defer it explicitly to Phase 8 if runtime behavior should land first.
- [x] Verify `pnpm -s --filter affordance test` fails because `../../src/v2/index.js` is missing.

### Phase 2: Minimal v2 app, route builders, and direct invocation

Implement the smallest v2 runtime that can construct an app, derive command metadata, and invoke commands directly by route key. Do not implement help rendering, command-line parsing from `exec(commandLine)`, input parsing, or middleware in this phase unless the tests require a no-op placeholder.

- [x] First trim or add tests so this phase covers only `Aff.cli(...).routes(...)`, groups, commands, `getCommands()`, and `invoke(routeKey)` for no-input commands.
- [x] Create `packages/affordance/src/v2/index.ts` exporting `Aff`.
- [x] Implement `Aff.cli(name).routes(routes)`.
- [x] Implement `Aff.group(config).routes(routes)`.
- [x] Implement `Aff.command(config).handle(handler)`.
- [x] Derive `routeKey`, `path`, and `description` from the route tree.
- [x] Throw a clear error for unknown route keys in `invoke(...)`.
- [x] Verify the Phase 2 tests pass while later v2 tests may still fail.

### Phase 3: Help and command-line route resolution

Add `exec(commandLine)` and help rendering independent of input parsing complexity. This phase should preserve the v1 user-facing help behaviors that v2 intentionally keeps while changing the public execution interface to accept a single string.

- [x] First add or adjust tests for root help, group help, command help, exact group invocation rendering group help, and nearest-help unknown command errors.
- [x] Implement `app.exec(commandLine)` route matching for command paths and group paths.
- [x] Parse the command-line string into tokens for v2 execution. Keep the initial tokenizer small and driven by current tests.
- [x] Implement `help`, `--help`, and `-h` handling.
- [x] Implement root, group, and command help rendering.
- [x] Implement nearest-group help for unknown commands.
- [x] Verify the Phase 3 route/help tests pass.

### Phase 4: Input declarations and parsing

Add input schemas and command argument parsing. Keep this phase focused on the parsing behavior v2 needs before middleware can rely on parsed input.

- [x] First add or adjust tests for argument parsing, options, flags, defaults, validation errors, and command-line parse errors before handler execution. Parse-before-middleware behavior is covered in Phase 7 once middleware exists.
- [x] Implement command `.arguments(args)` with an ordered argument tuple array.
- [x] Implement command `.options(options)` with an option schema object.
- [x] Implement plain zod schemas as valid option declarations.
- [x] Implement `Aff.option(schema)` for valued options.
- [x] Implement `Aff.flag(config?)` for boolean flags.
- [x] Implement raw `invoke(...)` input parsing using the existing zod-based behavior as a reference, not a blind copy.
- [x] Implement command argument parsing in `exec(commandLine)` after the command-line string has been tokenized.
- [x] Implement required argument and option errors.
- [x] Keep additional option metadata, aliases, passthrough, global options, and variadic arguments deferred until tests for those behaviors are added.
- [x] Verify the Phase 4 input tests pass.

### Phase 5: Teg parser-based command-line parsing

Replace the handwritten command-line input parser with `teg-parser` before expanding CLI grammar features. Keep route resolution separate from input parsing: route matching should identify the command path, then the Teg-based parser should parse the remaining tokens into Aff raw input.

The team owns `teg-parser`, so gaps in the parser API should be fixed upstream and published instead of worked around indefinitely in Affordance.

- [ ] First add focused parser tests for quoted strings, `--option value`, `--option=value`, flags, missing option values, unknown options, and positional arguments.
- [ ] Add `teg-parser` as an Affordance development/runtime dependency only after confirming its package metadata and dependency footprint are acceptable.
- [ ] Move command-line input parsing out of `packages/affordance/src/v2/input.ts` if a dedicated parser module keeps `input.ts` focused on schema validation and input definitions.
- [ ] Replace `parseCommandLineInput(...)` internals with Teg parser combinators while preserving the public Aff raw input shape `{ arguments, options }`.
- [ ] Preserve current Phase 4 error messages unless a Teg parse failure gives a clearly better Aff-owned message.
- [ ] Keep help detection and command route matching outside the Teg parser for now.
- [ ] Verify existing Phase 4 exec parsing tests still pass.

### Phase 6: Standard Schema input support

Make Aff v2 schema-agnostic before middleware starts depending on parsed input. Zod should keep working, but the input layer should depend on the Standard Schema interface instead of Zod-specific parsing APIs.

- [ ] First add tests that use at least one non-Zod Standard Schema implementation or a small in-test Standard Schema fixture for arguments and options.
- [ ] First add type tests proving `AffInputFor` infers Standard Schema output types for arguments, plain options, and `Aff.option(schema)`.
- [ ] Replace `ZodTypeAny` constraints in `packages/affordance/src/v2/input.ts` with a local Standard Schema-compatible type.
- [ ] Replace `z.output<T>` inference with Standard Schema output inference.
- [ ] Validate each argument and option independently through `schema["~standard"].validate(...)` instead of building a Zod object schema.
- [ ] Make command input parsing async if needed, because Standard Schema validation may return a promise.
- [ ] Keep required argument and option errors by validating `undefined`: if a schema accepts `undefined`, use the schema output; otherwise throw the Aff-specific missing input error.
- [ ] Replace `z.prettifyError(...)` with an Aff-owned Standard Schema issue formatter.
- [ ] Decide whether `Aff.flag()` continues to use Zod internally or uses a tiny Aff-owned boolean Standard Schema.
- [ ] Verify existing Zod-based Phase 4 tests still pass.

### Phase 7: Runtime middleware

Add middleware builders and oRPC-style runtime composition. This phase should not attempt full type-level context propagation; it should prove runtime semantics first.

- [ ] First add or adjust tests for before/after ordering around `await next()`.
- [ ] First add tests for `next()` rejecting with the original downstream handler error.
- [ ] First add tests for short-circuiting when middleware returns without calling `next()`.
- [ ] First add tests for root, group, and command middleware structural order.
- [ ] First add tests proving root middleware does not run for help output, exact group help, unknown commands, or input validation failures.
- [ ] Implement `.use(...)` on CLI, group, and command builders.
- [ ] Implement `Aff.middleware(fn)` as an identity helper.
- [ ] Implement `Aff.middleware(config).handle(fn)`.
- [ ] Compose middleware around handlers recursively or iteratively.
- [ ] Implement `next({ ctx })` as shallow downstream context merging.
- [ ] Preserve thrown errors when middleware does not catch them.
- [ ] Verify the Phase 7 middleware tests pass.

### Phase 8: Type-level context and input contracts

Add the type system for context propagation after runtime semantics are stable. This phase should be allowed to change generic signatures without changing runtime behavior.

- [ ] First add type-level tests that a second middleware sees context injected by the first middleware.
- [ ] First add type-level tests that a handler sees context injected by all prior middleware.
- [ ] First add type-level tests that unprovided context keys are rejected with `@ts-expect-error`.
- [ ] First add type-level tests for `$input<T>()` and `$context<T>()` contracts.
- [ ] Implement the generic `.use(...)` chain so downstream `ctx` includes middleware-provided fields.
- [ ] Implement typed `next({ ctx })` patches.
- [ ] Implement `$input<T>()` and `$context<T>()` on middleware builders if the tests choose that API.
- [ ] Verify `pnpm -s --filter affordance type-check` passes.

### Phase 9: Complete v2 parity decisions

Decide which remaining v1 features are required before Libretto can migrate. Add focused tests and implementation for only those features.

Candidate features:

- [ ] Named option aliases.
- [ ] Passthrough arguments after `--`.
- [ ] Global options.
- [ ] Variadic arguments.
- [ ] `appendHelpText` or equivalent root help extension.
- [ ] Refine and super-refine helpers on input declarations.
- [ ] Duplicate route validation.
- [ ] Missing handler validation.

### Phase 10: Migrate Libretto CLI call sites

Migrate Libretto after Aff v2 is stable enough to support current command behavior. This phase should start with Libretto-facing regression tests.

- [ ] First add or update Libretto CLI tests proving shared middleware-injected context reaches handlers under `next({ ctx })`.
- [ ] First add or update Libretto CLI tests proving a session middleware failure prevents the handler from running.
- [ ] First add or update Libretto CLI tests proving command handlers do not manually call middleware continuation.
- [ ] Update `withExperiments()` to call `next({ ctx: { ...ctx, experiments } })`.
- [ ] Update `withRequiredSession()` to call `next({ ctx: { ...ctx, session, logger, sessionState } })`.
- [ ] Update `withAutoSession()` to call `next({ ctx: { ...ctx, session, logger } })`.
- [ ] Migrate representative command groups from `SimpleCLI` to `Aff`.
- [ ] Run the smallest relevant Libretto CLI tests that cover session middleware behavior.

### Phase 11: Update telemetry spec to consume Aff v2 middleware

Update the telemetry plan once v2 middleware can observe successful and failed command execution centrally.

- [ ] First add v2 tests for root middleware observing successful command completion through `await next()`.
- [ ] First add v2 tests for root middleware observing failed command completion through `next()` rejection.
- [ ] First add v2 tests proving root middleware receives resolved `command.path` and `command.routeKey`.
- [ ] Update `specs/telemetry.md` to reference Aff v2 and this spec.
- [ ] Ensure telemetry's success/failure behavior depends on `next()` resolving or rejecting.

## Important files/docs/websites for implementation

- `packages/affordance/src/v2/index.ts` - new Aff v2 implementation.
- `packages/affordance/test/v2/*.spec.ts` - new v2 tests.
- `packages/affordance/src/index.ts` - existing `SimpleCLI` v1 implementation; leave unchanged during v2 build phases.
- `packages/affordance/test/affordance.spec.ts` - existing v1 tests; copy only behavior that is an explicit v2 goal.
- `packages/libretto/src/cli/commands/shared.ts` - Libretto's reusable `withRequiredSession`, `withAutoSession`, and `withExperiments` middleware for the later migration phase.
- `packages/libretto/src/cli/router.ts` - later telemetry work will install root-level middleware here.
- `specs/telemetry.md` - downstream spec that depends on this middleware model before anonymous CLI telemetry can be centralized.
- `https://orpc.dev/docs/middleware` - reference model: oRPC middleware receives `next`, can run logic before and after it, can inject context through `next({ context: ... })`, and lets downstream errors propagate unless caught.
