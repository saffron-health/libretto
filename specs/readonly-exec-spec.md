## Problem overview

In read-only sessions, `exec` is fully blocked. Agents still need a safe way to inspect page state and troubleshoot without risking side effects (clicks, typing, navigation, or network mutations).

## Solution overview

Add a new `readonly-exec` CLI command that reuses the `exec` runtime pipeline but enforces a strict read-only sandbox:

- allow read-only observation through the proxied `page`, `snapshot`, locator text reads, and `get`
- block mutating Playwright actions (click/fill/type/press/check/selectOption/hover/drag/navigation methods)
- block outbound network mutation requests (raw `fetch`, non-GET requests, `XMLHttpRequest`, `navigator.sendBeacon`, form submit)
- keep command output and ergonomics aligned with `exec`

## Goals

- Agents can run diagnostic read-only snippets in read-only sessions.
- `readonly-exec` does not allow browser actions or request dispatch.
- Command UX mirrors `exec` so migration is straightforward in skills.
- Safety checks fail fast with clear error text when blocked APIs are used.

## Non-goals

- No migrations or backfills.
- No static AST security analysis for arbitrary JavaScript.
- No guarantee of perfect browser-level containment against all evasive code.

## Future work

- Add structured policy presets (e.g. `readonly-exec --policy strict|inspect-dom|network-only`).
- Add command-level execution transcripts for denied operations.

## Important files/docs/websites for implementation

- `packages/libretto/packages/libretto/src/cli/commands/execution.ts` — add `readonly-exec` command parsing and shared execution wiring.
- `packages/libretto/packages/libretto/src/cli/core/readonly-exec.ts` — read-only Playwright proxies and helper surface.
- `packages/libretto/packages/libretto/test/basic.spec.ts` — usage and argument behavior for the new command.
- `packages/libretto/packages/libretto/test/stateful.spec.ts` — browser-backed allowed/denied behavior tests.
- `packages/libretto/packages/libretto/test/fixtures.ts` — subprocess test helpers.
- `packages/libretto/packages/libretto/skills/libretto/SKILL.md` — interactive skill guidance now points read-only flows at `libretto-readonly`.
- `packages/libretto/packages/libretto/skills/libretto-readonly/SKILL.md` — source-of-truth read-only diagnosis skill.

## Implementation

### Phase 1: Add command surface and wiring

- [x] Add `readonly-exec <code>` command and usage text.
- [x] Reuse existing `compileExecFunction` pipeline for execution.
- [x] Keep `exec` behavior unchanged for interactive sessions.
- [x] Success criteria: command is discoverable in `--help` and returns usage errors analogous to `exec`.

### Phase 2: Build read-only runtime guardrails

- [x] Introduce `createReadonlyExecHelpers` derived from current `exec` helpers.
- [x] Replace raw network access with a GET-only helper and a denied raw `fetch`.
- [x] Wrap `page` and chained locators with allowlisted read-only proxies.
- [x] Return deterministic errors like `ReadonlyExecDenied: page.click is blocked in readonly-exec`.
- [x] Success criteria: known mutating calls fail immediately before side effects.

### Phase 3: Add tests for allowed vs denied operations

- [x] Add tests that `readonly-exec` supports read-only page inspection, chained locator reads, and snapshot payloads.
- [x] Add tests that read operations succeed (e.g., `return await page.title()`, locator reads, GET requests).
- [x] Add tests that mutating APIs are denied (`page.fill`, `page.goto`, `get(..., { method: 'POST' })`).
- [x] Success criteria: targeted CLI tests verify both safety boundaries and retained read-only utility.

### Phase 4: Skill/doc rollout

- [x] Update skill instructions so agents use `readonly-exec` by default in read-only diagnosis mode.
- [x] Keep `exec` documented as the interactive tool and point read-only flows at `libretto-readonly`.
- [x] Success criteria: skill docs show a clear decision path between interactive repair and read-only inspection.
