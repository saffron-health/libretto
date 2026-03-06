## Problem overview

`libretto-cli exec` currently injects the raw Playwright `page`/`context` objects and monkey-patches methods in place for action logging. This makes behavior harder to reason about, and timeout diagnostics are inconsistent (especially for `locator.fill()`), since we do not have Playwright-core fork hooks for actionability reasons.

We want a no-fork path that still gives better diagnostics by passing instrumented objects into the exec sandbox, while preserving existing action logging and visualization behavior.

## Solution overview

Introduce an explicit exec-binding layer that returns wrapped `page`/`context` helpers (via JS Proxy or equivalent method-wrapping facade) and inject those wrapped objects into exec instead of raw Playwright instances.

The wrapper will keep existing action logging behavior, add timeout-error enrichment for `fill` (and pointer actions), and ensure `context.newPage()` pages are wrapped automatically. This delivers descriptive failures without modifying Playwright internals.

## Goals

- `exec` uses wrapped/instrumented `page` and `context` objects instead of raw instances.
- `locator.fill()` timeout errors include actionable diagnostics (visibility/enabled/editable/readonly-style hints) without forking Playwright.
- Existing action logging and stall-detection signals continue to work for page actions and chained locator actions.
- Newly created pages from `context.newPage()` inherit the same exec instrumentation automatically.

## Non-goals

- No migrations or backfills.
- No Playwright fork or patching `playwright-core`.
- No rewrite of visualization internals in `packages/libretto/src/instrumentation`.
- No attempt to perfectly replicate Playwright internal retry-state reasons; diagnostics remain best-effort inference.
- No broad browser-lifecycle redesign across non-`exec` CLI commands.

## Future work

- Extend wrapping to `browser.newContext()` and other advanced page/context creation paths used by power users.
- Add optional structured diagnostic payloads in action logs (not only appended error text).
- Reuse the same wrapper layer for other runtime entrypoints beyond `exec`.

## Important files/docs/websites for implementation

- `packages/libretto-cli/src/commands/execution.ts` - current `runExec` implementation, exec helper injection, and visualize wiring.
- `packages/libretto-cli/src/core/telemetry.ts` - existing page/locator action logging wrappers and locator-chain wrapping logic.
- `packages/libretto-cli/src/cli.ts` - command registration and user-visible `exec` help/usage context.
- `packages/libretto/src/instrumentation/errors.ts` - existing timeout-enrichment patterns and diagnostics format.
- `packages/libretto/src/instrumentation/instrument.ts` - current locator/page wrapping approach used for visualization mode.
- `packages/libretto-cli/src/cli-basic.test.ts` - CLI behavior baseline and command usage expectations.
- `packages/libretto-cli/src/cli-stateful.test.ts` - stateful command testing patterns and fixture style.
- `packages/libretto-cli/src/test-fixtures.ts` - subprocess test harness and build/test workflow constraints.
- [Playwright auto-waiting/actionability docs](https://playwright.dev/docs/actionability) - authoritative actionability checks (`visible`, `enabled`, `editable`, etc.) to align diagnostics wording.
- [Playwright locator docs](https://playwright.dev/docs/locators) - locator chaining semantics that wrapper logic must preserve.
- [MDN Proxy `get` trap docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/get) - JS Proxy behavior/invariants and method interception constraints.

## Implementation

### Phase 1: Extract exec binding wrapper module

Create a dedicated exec-binding module that owns how `page`/`context` are wrapped for sandbox execution. This centralizes behavior and makes later diagnostics changes isolated from command wiring.

- [x] Create `packages/libretto-cli/src/core/exec-bindings.ts` to encapsulate wrapped `page`/`context` objects used by `runExec`.
- [x] Keep telemetry concerns in `core/telemetry.ts`, but expose a single binding factory in `core/exec-bindings.ts` that composes telemetry wrapping for exec.
- [x] Keep behavior parity for current logging fields (`action`, `selector`, `value`, `duration`, `success`, `error`) to avoid log-format regressions.
- [x] Success criteria: `pnpm --filter libretto-cli type-check` passes and existing `cli-basic`/`cli-stateful` tests remain green with no behavior changes yet.

### Phase 2: Add no-fork timeout diagnostics for fill and pointer actions

Add best-effort timeout enrichment in the exec wrapper path so failures include actionable reasons without touching Playwright internals. Focus first on `fill` and pointer actions where current timeout messages are least informative.

- [ ] Add an exec-focused timeout enrichment helper (new file or reuse from `libretto` instrumentation) that appends best-effort diagnostic reasons.
- [ ] Add `fill`-specific probes aligned to Playwright actionability semantics (at least: visible/enabled/editable checks, with readonly-style hint when detectable).
- [ ] Invoke enrichment from wrapped locator/page action methods when a timeout error occurs, before rethrowing.
- [ ] Ensure enrichment is additive and non-fatal (probe failures never mask original Playwright errors).
- [ ] Success criteria: unit tests assert timeout messages include `[libretto diagnostics]` reasons for `fill` and pointer timeout cases.

### Phase 3: Wrap context-created pages for exec sessions

Ensure instrumentation is not limited to the initially connected page by wrapping pages created during exec flows. This keeps logging and diagnostics consistent for multi-page scripts.

- [ ] Extend exec bindings so `context.newPage()` returns already wrapped pages.
- [ ] Ensure wrapped pages preserve existing action logging + timeout enrichment behavior for all locator/page actions.
- [ ] Preserve expected `this` binding for Playwright methods when wrapping to avoid runtime method-call breakage.
- [ ] Success criteria: unit tests cover `context.newPage()` instrumentation inheritance and chained locator wrapping on new pages.

### Phase 4: Wire runExec to inject wrapped helpers

Switch `runExec` helper injection to use the new wrapped bindings as the default runtime contract. Keep current `--visualize` behavior intact while removing duplicated inline wrapping logic.

- [ ] Update `runExec` to build wrapped exec bindings once and inject wrapped `page`/`context` into the exec function helpers object.
- [ ] Keep `--visualize` behavior intact by composing existing visualization instrumentation with wrapped exec bindings.
- [ ] Remove now-redundant in-function wrapping code from `commands/execution.ts` once the extracted module is wired.
- [ ] Success criteria: `pnpm --filter libretto-cli test` passes, and a manual exec smoke run confirms actions still log while timeout messages are enriched.

### Phase 5: Add targeted wrapper tests

Add focused tests around wrapping semantics so regressions are caught without requiring full browser end-to-end runs. The test scope should validate proxy/wrapper correctness, not re-test Playwright itself.

- [ ] Add `packages/libretto-cli/src/core/exec-bindings.test.ts` with focused unit tests (mock/fake page+locator objects) for:
- [ ] `get`-based method wrapping preserves call behavior (`this` context safe).
- [ ] locator-returning methods (`first/last/locator/getBy*/filter/and/or/nth/all`) remain wrapped recursively.
- [ ] timeout enrichment is invoked only for timeout-like failures and does not alter non-timeout errors.
- [ ] Success criteria: tests fail on regression in wrapping behavior and pass under `pnpm --filter libretto-cli test`.
