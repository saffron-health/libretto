## Problem overview

In read-only sessions, `exec` is fully blocked. Agents still need a safe way to inspect page state and troubleshoot without risking side effects (clicks, typing, navigation, or network mutations).

## Solution overview

Add a new `readonly-exec` CLI command that reuses the `exec` runtime pipeline but enforces a strict read-only sandbox:

- allow read-only observation helpers (`page.content`, `page.title`, locator text reads, `networkLog`)
- block mutating Playwright actions (click/fill/type/press/check/selectOption/hover/drag/navigation methods)
- block outbound network mutation requests (`fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, form submit)
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

- `packages/libretto-cli/src/index.ts` — add `readonly-exec` command parsing and runtime.
- `packages/libretto-cli/src/cli-basic.test.ts` — usage and argument behavior for the new command.
- `packages/libretto-cli/src/cli-stateful.test.ts` — read-only session behavior tests.
- `packages/libretto-cli/src/test-fixtures.ts` — seeded session and permission fixtures.
- `packages/libretto/skills/original-skill/SKILL.md` — switch read-only workflows from `exec` to `readonly-exec`.
- `packages/libretto/skills/libretto-network-skill/SKILL.md` — same as above for `.bin/libretto-cli` workflow.

## Implementation

### Phase 1: Add command surface and wiring

- [ ] Add `readonly-exec <code>` command and usage text.
- [ ] Reuse existing `compileExecFunction` pipeline for execution.
- [ ] Keep `exec` behavior unchanged for interactive sessions.
- [ ] Success criteria: command is discoverable in `--help` and returns usage errors analogous to `exec`.

### Phase 2: Build read-only runtime guardrails

- [ ] Introduce `createReadOnlyExecHelpers` derived from current `exec` helpers.
- [ ] Remove/replace mutating globals (`fetch` wrapper that denies non-GET/HEAD, deny XHR/sendBeacon/form submit APIs).
- [ ] Wrap `page`/`context` with deny-list guards for mutating Playwright methods.
- [ ] Return deterministic errors like `ReadonlyExecDenied: page.click is blocked in readonly-exec`.
- [ ] Success criteria: known mutating calls fail immediately before side effects.

### Phase 3: Add tests for allowed vs denied operations

- [ ] Add tests that `readonly-exec` works in read-only sessions where `exec` is blocked.
- [ ] Add tests that read operations succeed (e.g., `return await page.title()`, `return await networkLog()`).
- [ ] Add tests that mutating APIs are denied (`page.click`, `page.goto`, `fetch('POST ...')`).
- [ ] Success criteria: test suite verifies both safety boundaries and retained read-only utility.

### Phase 4: Skill/doc rollout

- [ ] Update skill instructions so agents use `readonly-exec` by default in read-only mode.
- [ ] Keep `exec` only after explicit interactive authorization.
- [ ] Success criteria: skill docs show a clear decision path: read-only inspect first, interactive only with explicit user approval.
