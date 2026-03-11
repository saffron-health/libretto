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

For v1, keep yargs as the parsing engine behind a parser adapter seam (no parser rewrite), but move command code to typed `input` objects and middleware context so raw `argv` is no longer plumbed through handlers. Add explicit session middlewares (`autocreateSessionMiddleware`, `sessionSetupMiddleware`) that run after parse/input validation and before handler execution.

In v1, framework output stays human-first. `SimpleCLI` will own rendering and stream behavior for human mode only. Machine-mode output (`--json`) is deferred.

Adapter rationale: the seam is not for abstraction-for-abstraction's-sake; it isolates parser-specific code to one module so we can migrate off yargs later without another full command refactor. Without that seam, parser replacement would require touching command definitions and bootstrap flow again.

## Goals

- Define commands in a router/procedure style that is structurally similar to oRPC.
- Support first-class subcommand groups with shared middleware (`const ai = SimpleCLI.use(aiMiddleware).group({ configure: ... })`).
- Ensure each command is defined once in one module (route identity, input normalization, middleware, handler, help metadata), with no duplicate command allowlists or secondary registration maps.
- Ensure each command's input is defined once in one place using `{ positionals, named }` (no separate positional map + separate Zod object that can drift).
- Enforce subcommand-scoped help contracts (purpose, usage, args, flags, examples) from framework metadata rather than ad-hoc per-command strings.
- Eliminate raw `argv` plumbing from command handlers in `packages/libretto/src/cli/commands/*`.
- Support reusable middleware that runs after parsing/input normalization and before handlers.
- Centralize session-related pre-handler logic in dedicated middleware used by `open`/`run` and commands that connect to an existing session.
- Enforce deterministic output and stream conventions by default (`stdout` for result payloads, `stderr` for diagnostics/help/recovery).
- Keep user-facing API minimal in v1 while enforcing the above via framework defaults.
- Preserve existing user-facing behavior (usage strings, error contracts, exit codes, session defaults).

## Non-goals

- No migrations or backfills.
- No yargs removal in v1 implementation; parser replacement is intentionally deferred behind an adapter seam.
- No behavior redesign of browser/runtime primitives (`runOpen`, `runIntegrationFromFile`, `connect`, etc.).
- No command UX copy rewrite beyond what is required to preserve current output contracts.
- No plugin system or third-party extension API for CLI middleware in v1.
- No manual per-command path strings in command definitions; route paths are derived from router/group keys.
- No free-form/unstructured error printing from handlers; handlers return typed error/result objects and framework owns final rendering.
- No machine-mode (`--json`) output in v1.
- No built-in `--dry-run` framework behavior in v1.
- No mandatory failure-context middleware in v1.

## Future work

- Expose the internal CLI procedure builder as a public package API if external integrations need to register custom commands.
- Add machine-mode output (`--json`) with command-level typed success/error payload schemas.
- Add command composition utilities for nested command groups (`ai configure`, future namespaces) with less boilerplate.
- Evaluate replacing yargs once the router/group API is stable and fully covered by tests.
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
- `packages/libretto/test/basic.spec.ts` - error/help/usage contracts for parser behavior.
- `packages/libretto/test/stateful.spec.ts` - sessioned command behavior and command output contracts.
- `packages/libretto/test/multi-page.spec.ts` - page-targeting behavior for connect-backed commands.
- [oRPC middleware](https://orpc.dev/docs/middleware) - procedure middleware pattern (`use` + pre/post handler execution).
- [oRPC router](https://orpc.dev/docs/router) - nested router composition model and middleware application patterns.
- [oRPC OpenAPI getting started](https://orpc.dev/docs/openapi/getting-started) - route + input/output builder style reference.
- [yargs command modules and middleware API](https://github.com/yargs/yargs/blob/main/docs/api.md) - parser primitives used under the new CLI layer.

## Implementation

### Phase 1: Add SimpleCLI core primitives and parser adapter seam

- [ ] Add a new internal module (e.g. `packages/libretto/src/cli/framework/simple-cli.ts`) with:
- [ ] `SimpleCLI.define(name, routes)` root definition helper.
- [ ] `SimpleCLI.command` builder supporting `.input`, `.use`, and `.handle`.
- [ ] `SimpleCLI.group` builder supporting nested groups and group-level middleware.
- [ ] `SimpleCLI.middleware` helper type for reusable middleware functions.
- [ ] `SimpleCLI.input({ positionals, named })` DSL with `SimpleCLI.positional`, `SimpleCLI.option`, and `SimpleCLI.flag`.
- [ ] `SimpleCLI.help(...)` metadata model for subcommand-scoped help sections (purpose, usage, required args, optional flags, examples).
- [ ] Add a parser adapter interface (e.g. `SimpleCLIParserAdapter`) so `SimpleCLI` execution is decoupled from yargs-specific objects.
- [ ] Auto-derive command route metadata from router keys (`routeKey`, CLI tokens) and expose it to middleware/handlers.
- [ ] Auto-derive parser bindings and canonical Zod object schema from each command input definition.
- [ ] Implement deterministic middleware execution order (definition order) before handler invocation.
- [ ] Keep yargs-backed command/option registration in this phase via the adapter; only wrap execution flow.
- [ ] Ensure router entries are the sole command source-of-truth consumed by parser registration (no manual command name set in bootstrap).
- [ ] Success criteria: focused tests prove route derivation, input parsing, and middleware ordering work independently of concrete command modules.
- [ ] Example target shape:

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
    help: SimpleCLI.help({
      purpose: "Launch browser and open URL (headed by default)",
      usage: "libretto-cli open <url> [--headless] [--session <name>]",
      examples: [
        "libretto-cli open https://example.com",
        "libretto-cli open https://example.com --headless --session debug",
      ],
    }),
  })
    .input(openInput)
    .use(autocreateSessionMiddleware)
    .handle(runOpenCommand),
  ai: SimpleCLI.use(aiMiddleware).group({
    configure: SimpleCLI.command({
      help: "Configure AI runtime",
    })
      .input(aiConfigureInput)
      .handle(runAiConfigureCommand),
  }),
});
```

### Phase 2: Add subcommand-scoped help rendering contract

- [ ] Implement help renderer in `SimpleCLI` using `SimpleCLI.help(...)` metadata:
- [ ] root help stays high-level,
- [ ] subcommand help includes purpose, usage, required args, optional flags, and examples.
- [ ] Wire `help`, `--help`, and `help <subcommand>` into router-derived command tree.
- [ ] Migrate one command group (`ai configure`) help to the new contract as a pilot.
- [ ] Success criteria: `basic.spec.ts` help-related assertions pass, and new tests verify subcommand help structure for `ai configure`.
- [ ] Example target shape:

```ts
SimpleCLI.command({
  help: SimpleCLI.help({
    purpose: "Configure AI runtime",
    usage: "libretto-cli ai configure [preset] [-- <command prefix...>]",
    requiredArgs: [],
    optionalFlags: ["--clear"],
    examples: [
      "libretto-cli ai configure codex",
      "libretto-cli ai configure codex -- node ./agent.js",
    ],
  }),
});
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

const openCommand = SimpleCLI.command({ help: "Launch browser and open URL (headed by default)" })
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

- [ ] Refactor `cli.ts` to build parser/commands from `SimpleCLI.define(...)` route tree with grouped namespaces (including `ai.configure`) rather than `register*Commands(...)` factories.
- [ ] Remove `filterSessionArgs` and command-token allowlist plumbing that duplicates parser responsibilities.
- [ ] Keep top-level usage/help/unknown-command behavior stable (including `help`, `--help`, and unknown command flow).
- [ ] Ensure logger initialization still works on early failures and writes to the expected session/default log path.
- [ ] Success criteria: help/unknown/invalid-session tests in `basic.spec.ts` pass without output regressions, and command lookup/registration originates only from the router tree.
- [ ] Example target shape:

```ts
export async function runLibrettoCLI(): Promise<void> {
  ensureLibrettoSetup();
  const app = buildLibrettoSimpleCLI();
  const parser = createYargsParserAdapter(process.argv.slice(2));
  await app.run(parser);
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
