## Problem overview

Affordance middleware currently runs only as a pre-handler context builder: each middleware receives `{ input, ctx, command }`, returns a replacement context, and then the handler runs after all middleware completes. That model is enough for validation and context injection, but it cannot express cross-cutting behavior that needs to run both before and after handler execution, such as telemetry, timing, cleanup, tracing, or centralized error observation.

The next telemetry work needs middleware to behave like oRPC middleware: a middleware runs code before `next()`, calls `next()` to continue downstream execution, then runs code after `next()` resolves or rejects.

## Solution overview

Change SimpleCLI `.use(...)` middleware semantics to an oRPC-style chain. Middleware receives `next`, may call `await next({ ctx: ... })` to continue with merged context, and can run logic before and after that call. If downstream middleware or the command handler throws, `next()` rejects with that error; middleware can catch it for observation or transformation, and uncaught errors continue propagating to the CLI bootstrap.

Keep the existing SimpleCLI handler argument names (`ctx`, `input`, `command`) instead of renaming to oRPC's `context`, because Libretto command handlers already use `ctx` throughout the codebase. The execution model should mirror oRPC; the local naming does not need to.

## Goals

- Middleware can run code before and after downstream command execution.
- Middleware can observe command success and failure without modifying every command handler.
- Middleware can still inject or refine context for downstream middleware and handlers.
- `next()` rejects when downstream middleware or the handler throws, unless an intermediate middleware catches and handles the error.
- Existing command handlers continue receiving `{ input, ctx, command }`.
- Existing Libretto session/experiment middleware is migrated to the new `next({ ctx })` style.
- Root-level middleware can be installed once on `SimpleCLI.define(...)` and applies to every resolved command.
- Tests clearly specify ordering, short-circuiting, context merging, and error propagation.

## Non-goals

- No migrations or backfills.
- No public plugin system or third-party middleware registry.
- No input mapping API like oRPC's `.mapInput(...)` in v1.
- No middleware concatenation helper in v1.
- No built-in lifecycle middleware helpers such as `onStart`, `onSuccess`, `onError`, or `onFinish` in v1.
- No handler output envelope; command handlers can still return any value.
- No rename from `ctx` to `context` across Libretto command handlers.

## Semantics

SimpleCLI middleware should follow these rules:

- Middleware signature is `async ({ input, ctx, command, next }) => { ... }`.
- Calling `await next()` continues to the next middleware, or the command handler if there is no later middleware.
- Calling `await next({ ctx: patch })` merges `patch` into the current context for downstream execution.
- Root-level middleware from `SimpleCLI.define(..., { middlewares: [...] })` runs after route matching and input parsing, before group and command middleware.
- Root-level middleware does not run for help output, version output handled outside SimpleCLI, exact group help, unknown commands, parse errors before command resolution, or input validation failures.
- The context visible after `await next(...)` is not automatically mutated for the current middleware; middleware that needs a local value should keep a local variable.
- If a middleware returns without calling `next()`, it short-circuits downstream execution and its return value becomes the command result.
- If downstream execution throws, `next()` rejects with the same error object.
- If middleware catches the error and rethrows it, the CLI sees the original failure.
- If middleware catches the error and returns a value, the command is considered handled successfully from the caller's perspective.

## Important files/docs/websites for implementation

- `packages/affordance/src/index.ts` - SimpleCLI types, command builder, group builder, route resolution, and `SimpleCLIApp.invoke(...)` middleware execution.
- `packages/affordance/test/affordance.spec.ts` - framework tests for route derivation, middleware ordering, context typing, and error behavior.
- `packages/libretto/src/cli/commands/shared.ts` - Libretto's reusable `withRequiredSession`, `withAutoSession`, and `withExperiments` middleware that must be migrated to `next({ ctx })`.
- `packages/libretto/src/cli/commands/browser.ts` - representative command group using chained middleware.
- `packages/libretto/src/cli/commands/execution.ts` - representative command group using chained middleware and session context.
- `packages/libretto/src/cli/router.ts` - later telemetry work will install a root-level middleware here.
- `specs/telemetry.md` - downstream spec that depends on this middleware model before anonymous CLI telemetry can be centralized.
- `https://orpc.dev/docs/middleware` - reference model: oRPC middleware receives `next`, can run logic before and after it, can inject context through `next({ context: ... })`, and lets downstream errors propagate unless caught.

## Implementation

Use a test-first flow for every phase. Add the behavioral or type-level tests before changing implementation code, even when those tests do not compile or fail immediately. The red tests are the contract for the phase; implementation follows only after the expected behavior is captured.

### Phase 1: Replace pre-handler middleware execution with an oRPC-style chain

Start by rewriting the runtime middleware tests to describe `next()`-based execution. The first test-only change is expected to fail because `next` does not exist yet; then update SimpleCLI internals until those tests pass.

```ts
// packages/affordance/test/affordance.spec.ts
test("middleware wraps handler execution through next", async () => {
  const order: string[] = [];
  const noInput = SimpleCLI.input({ positionals: [], named: {} });

  const app = SimpleCLI.define("libretto", {
    run: SimpleCLI.command({ description: "run" })
      .input(noInput)
      .use(async ({ next }) => {
        order.push("before");
        const result = await next();
        order.push("after");
        return result;
      })
      .handle(async () => {
        order.push("handler");
        return "ok";
      }),
  });

  await expect(app.invoke("run", { positionals: [], named: {} })).resolves.toBe("ok");
  expect(order).toEqual(["before", "handler", "after"]);
});
```

- [ ] First add failing tests in `packages/affordance/test/affordance.spec.ts` for before/after ordering around `await next()`.
- [ ] First add failing tests for `next()` rejecting with the original downstream handler error.
- [ ] First add failing tests for middleware short-circuiting when it returns without calling `next()`.
- [ ] First add failing tests for root middleware order: root middleware, then group middleware from outermost to innermost, then command middleware, then handler.
- [ ] First add failing tests proving root middleware does not run for help output, exact group help, unknown commands, or input validation failures.
- [ ] Then update `SimpleCLIMiddleware` so middleware receives `next`.
- [ ] Then add `middlewares?: readonly SimpleCLIMiddleware[]` to `SimpleCLI.define(...)` config for root-level command middleware.
- [ ] Then update `SimpleCLIApp.invoke(...)` to compose middleware recursively or iteratively around the handler.
- [ ] Then implement `next({ ctx })` as a shallow merge with the current context for downstream execution.
- [ ] Then preserve thrown errors when middleware does not catch them.
- [ ] Verify `pnpm -s --filter affordance test` passes.

### Phase 2: Preserve typed context propagation under the new continuation model

Start by changing the existing type-level tests to the new `next({ ctx })` contract. This test-only change may fail to type-check at first; that is expected until the generic middleware signature is updated.

```ts
// packages/affordance/test/affordance.spec.ts
const validateSession: SimpleCLIMiddleware<
  { session?: string },
  {},
  { sessionState: { id: string } }
> = async ({ next }) => {
  return next({ ctx: { sessionState: { id: "default" } } });
};

const app = SimpleCLI.define("libretto", {
  open: SimpleCLI.command({ description: "open" })
    .input(openInput)
    .use(validateSession)
    .handle(async ({ ctx }) => {
      const id: string = ctx.sessionState.id;
    }),
});
```

- [ ] First update or replace the current typed middleware context test to use `next({ ctx })`.
- [ ] First add a type-level test that a second middleware sees context injected by the first middleware.
- [ ] First add a type-level test that a handler sees context injected by all prior middleware.
- [ ] First add a type-level test that an unprovided context key is still rejected with `@ts-expect-error`.
- [ ] Then keep the existing `.use(...)` generic chain so downstream handler `ctx` includes middleware-provided fields.
- [ ] Then make `next({ ctx })` type-check when the patch satisfies the middleware's declared output context.
- [ ] Verify `pnpm -s --filter affordance type-check` passes if the package exposes that script; otherwise verify root `pnpm -s type-check`.

### Phase 3: Migrate Libretto CLI middleware call sites

Start by adding Libretto-facing regression tests that exercise the shared middleware through real command definitions. These tests should fail until `withExperiments`, `withRequiredSession`, and `withAutoSession` call `next({ ctx })` instead of returning context.

```ts
// packages/libretto/test/multi-session.spec.ts
test("exec still rejects missing session through required-session middleware", async ({
  librettoCli,
}) => {
  const result = await librettoCli(`exec "return 1"`);
  expect(result.stderr).toContain("Missing required option --session.");
});
```

- [ ] First add or update Libretto CLI tests proving shared middleware-injected context reaches handlers under the new `next({ ctx })` model.
- [ ] First add or update Libretto CLI tests proving a session middleware failure still prevents the handler from running.
- [ ] First add or update Libretto CLI tests proving existing command handlers do not need to manually call middleware continuation.
- [ ] Then update `withExperiments()` to call `next({ ctx: { ...ctx, experiments } })`.
- [ ] Then update `withRequiredSession()` to call `next({ ctx: { ...ctx, session, logger, sessionState } })`.
- [ ] Then update `withAutoSession()` to call `next({ ctx: { ...ctx, session, logger } })`.
- [ ] Then confirm existing command handlers in `browser.ts`, `execution.ts`, `search.ts`, and `snapshot.ts` need no handler-level changes.
- [ ] Run the smallest relevant Libretto CLI tests that cover session middleware behavior.

### Phase 4: Update telemetry spec to consume the new middleware model

Start by adding the telemetry-facing affordance tests that telemetry will rely on: root middleware sees the resolved command metadata, observes success after `next()` resolves, and observes failure when `next()` rejects. These are affordance tests, not telemetry implementation tests.

```ts
// packages/affordance/test/affordance.spec.ts
test("root middleware observes success and failure through next", async () => {
  const events: Array<{ command: string; error: boolean }> = [];
  const observe: SimpleCLIMiddleware = async ({ command, next }) => {
    try {
      const result = await next();
      events.push({ command: command.path.join(" "), error: false });
      return result;
    } catch (error) {
      events.push({ command: command.path.join(" "), error: true });
      throw error;
    }
  };
  ...
});
```

- [ ] First add failing affordance tests for root middleware observing successful command completion through `await next()`.
- [ ] First add failing affordance tests for root middleware observing failed command completion through `next()` rejection.
- [ ] First add failing affordance tests proving root middleware receives resolved `command.path` and `command.routeKey`.
- [ ] Then update `specs/telemetry.md` to reference `specs/affordance-orpc-middleware-spec.md`.
- [ ] Then replace the telemetry spec's separate around-middleware phase with a dependency on SimpleCLI oRPC-style middleware.
- [ ] Then ensure telemetry's success/failure behavior depends on `next()` resolving or rejecting.
