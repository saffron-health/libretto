## Problem overview

Libretto mixes throw-based control flow with `{ ok: false }` result envelopes. Expected failures are often invisible in TypeScript return types, so agents and humans can miss error paths until runtime. [errore.org](https://errore.org/) gives a lighter pattern: return `T | SomeError`, check with `instanceof`, and let the compiler refuse unhandled cases. This repo has not adopted that convention yet, and a naive swap would break agent-facing tool and daemon contracts that intentionally serialize string errors across process boundaries.

## Solution overview

Adopt the errore.org *convention* inside Libretto TypeScript first: domain failures return typed `Error` subclasses in union return types, callers narrow with `instanceof`, and happy-path code stays flat. Keep existing agent and IPC envelopes (`ToolResult`, daemon `{ ok, message, output }`) unchanged, and map typed errors to those envelopes only at the boundary. Do not add the `errore` npm package or lintcn in this spec. Vendor an adapted agent skill and prove the pattern on one internal helper (`normalizeProfileName`) before wider migration.

## Goals

- Agents editing Libretto know when to return errors as values, when to throw, and when to use `{ ok: false }` envelopes.
- New and migrated internal TypeScript APIs document expected failures in their return types as `T | SpecificError`.
- Callers must handle returned errors with `instanceof` before using the success value, or TypeScript fails the build.
- Agent-facing tool, MCP-style, and CLI messages still follow the existing diagnosis-plus-next-step policy in `AGENTS.md`.
- `ToolResult` / `ToolErrorResult` in `packages/browser-tools` and daemon exec IPC result shapes stay stable.
- One internal pilot (`normalizeProfileName`) ships end-to-end with tests so later migrations have a concrete template.

## Non-goals

- No migrations or backfills.
- No `errore` npm dependency and no lintcn / `no-unhandled-error` CI rule in this spec.
- No change to public `ToolResult`, AI SDK / Pi adapters, or daemon `DaemonCommandResult` shapes.
- No rewrite of throw-heavy CLI entrypoints, providers, or Playwright integration in one pass.
- No change to public package exports that currently throw (`parseSessionStateData`, `parseSessionStateContent`, `LibrettoWorkflowInputError`, `DomainPolicyRestricted`) except where a later phase explicitly lists them.
- No Effect, neverthrow, or other Result-wrapper libraries.
- No attempt to make `browser_exec` / daemon REPL user code return errore-style unions (user code may still throw or return Error-like values; existing failure handling stays).

## Decisions locked for this spec

- Convention-only: plain `Error` subclasses with stable `name` (and optional `_tag` matching `name`). Helpers like `createTaggedError` wait for a later dependency decision.
- Freeze wire envelopes: tools and daemon IPC keep string error fields.
- Pilot module: `packages/libretto/src/shared/workflow/auth-profile-name.ts` (`normalizeProfileName`), which is not exported from the public `libretto` package entry.

## Future work

- Decide whether to add the `errore` package for `createTaggedError` / `matchError` / `try` in internal packages only.
- Add lintcn `no-unhandled-error` (or an equivalent type-aware rule) on migrated packages.
- Migrate additional internal helpers (session access guards, config parsing, CLI validation) using the pilot as the template.
- Consider a semver-major only if a future effort deliberately changes `ToolResult` or public parse APIs to return unions.

## Important files/docs/websites for implementation

- https://errore.org/ — convention reference (unions, `instanceof`, zero-dep philosophy, agent skill).
- https://github.com/remorses/errore/tree/main/skills/errore — upstream skill text to adapt (strip mandatory npm-package rules).
- `AGENTS.md` — repo agent rules; add the errore convention and keep the existing agent-facing error-message section.
- `.agents/skills/errore/SKILL.md` — new workspace skill (same class of skill as `generate-spec` / `cli-development`; not a Libretto product skill under `packages/libretto/skills/`).
- `packages/libretto/src/shared/workflow/auth-profile-name.ts` — pilot: return `string | InvalidProfileNameError`.
- `packages/libretto/src/cli/core/profiles.ts` — re-exports `normalizeProfileName` for CLI use.
- `packages/libretto/src/cli/commands/profiles.ts` — CLI caller that should map returned errors to user-facing failure.
- `packages/libretto/src/cli/core/browser.ts` — session/profile callers of `normalizeProfileName`.
- `packages/libretto/src/cli/core/daemon/daemon.ts` — daemon startup path that normalizes auth profile names.
- `packages/libretto/src/shared/workflow/workflow.ts` — workflow auth-profile parsing that currently assumes throws.
- `packages/libretto/test/profiles.spec.ts` — unit coverage for profile name validation.
- `packages/browser-tools/src/tool.ts` — `ToolResult` envelope that must remain the agent boundary.
- `packages/libretto/src/cli/core/daemon/ipc.ts` — daemon command result envelope that must remain the IPC boundary.
- `packages/libretto/src/shared/ipc/AGENTS.md` — existing guidance: use result shapes when failure is part of the contract; otherwise let throws reject over IPC.
- `docs/tests-guide.md` — test authoring rules before editing tests.
- `packages/libretto/skills/AGENTS.md` — clarifies that only Libretto product skills sync via `pnpm sync:mirrors`; do not put the errore coding skill there.

## Implementation

### Phase 1: Document the Libretto errore convention

Write the adoption rules into repo agent docs so later code changes have an explicit policy. Keep the existing agent-facing message rules; add a sibling section for internal TypeScript errors-as-values.

```md
<!-- AGENTS.md -->
## Errors as values (errore.org convention)

This codebase uses the errore.org convention for internal TypeScript.
ALWAYS read the `.agents/skills/errore` skill before changing error-handling code.

- Expected domain failures: return `T | SpecificError` and check with `instanceof`.
- Host misconfiguration agents cannot fix: throw (unchanged policy).
- Agent-facing tools and daemon exec: keep `{ ok: false, error|message }` envelopes; map typed errors to actionable strings at that boundary only.
- Do not add the `errore` npm package unless a later spec approves it.
```

- [ ] Add an "Errors as values" section to root `AGENTS.md` that points at `.agents/skills/errore`, states the return-vs-throw-vs-envelope split, and forbids adding the `errore` package without an explicit follow-up decision.
- [ ] Cross-link the new section from `packages/libretto/src/shared/ipc/AGENTS.md` in one short paragraph so IPC authors do not replace daemon result envelopes with bare `Error` returns over the wire.
- [ ] Success criteria: an agent reading `AGENTS.md` can state when to return, throw, or use `{ ok: false }` without reading this spec.

### Phase 2: Vendor an adapted errore skill

Add a workspace skill that teaches the convention without forcing the npm package or breaking Libretto boundary rules.

```md
<!-- .agents/skills/errore/SKILL.md -->
---
name: errore
description: >
  Errors as values for Libretto TypeScript: return T | SpecificError,
  check with instanceof. Adapted from errore.org for this monorepo.
---

# errore (Libretto)

Use plain Error subclasses and union returns. Do not import `errore` until approved.

Libretto exceptions:
- `ToolResult` / daemon `{ ok: false }` stay at process boundaries.
- Host misconfig and `DomainPolicyRestricted` may still throw.
- Agent-facing strings must include the next step (see root AGENTS.md).
```

- [ ] Create `.agents/skills/errore/SKILL.md` adapted from https://github.com/remorses/errore/blob/main/skills/errore/SKILL.md.
- [ ] Keep the core rules that matter here: return errors as values, `instanceof` early returns, typed domain errors, wrap third-party throws at the lowest boundary, do not return `unknown | Error`.
- [ ] Remove or rewrite upstream rules that require `import * as errore from 'errore'`, `createTaggedError`, `errore.try`, and "ALWAYS use errore for new TypeScript projects" so they match convention-only adoption.
- [ ] State the Libretto boundary exceptions (tool envelopes, daemon IPC, host throws, agent message policy) in the skill body.
- [ ] Do not place this skill under `packages/libretto/skills/` and do not run `pnpm sync:mirrors` for it.
- [ ] Success criteria: skill frontmatter is discoverable as `errore`, and the skill text never requires installing the npm package for Libretto work.

### Phase 3: Add `InvalidProfileNameError` and change the pilot return type

Make profile-name validation the first errors-as-values API. Keep the function small and pure so callers can adopt `instanceof` without browser or IPC setup.

```ts
// packages/libretto/src/shared/workflow/auth-profile-name.ts
export class InvalidProfileNameError extends Error {
  readonly _tag = "InvalidProfileNameError";
  readonly profileName: string;

  constructor(profileName: string, message: string) {
    super(message);
    this.name = "InvalidProfileNameError";
    this.profileName = profileName;
  }
}

export function normalizeProfileName(
  name: string,
): string | InvalidProfileNameError {
  const trimmed = name.trim();
  if (!trimmed) {
    return new InvalidProfileNameError(name, "Profile name is required.");
  }
  if (!isValidProfileName(trimmed)) {
    return new InvalidProfileNameError(
      name,
      `Invalid profile name "${name}". Use letters, numbers, dots, underscores, and dashes only.`,
    );
  }
  return trimmed;
}
```

- [ ] Add `InvalidProfileNameError` in `auth-profile-name.ts` with stable `name` / `_tag` and a `profileName` field.
- [ ] Change `normalizeProfileName` to return `string | InvalidProfileNameError` instead of throwing.
- [ ] Keep the same user-facing message text so CLI output stays familiar.
- [ ] Re-export the error class from `packages/libretto/src/cli/core/profiles.ts` if CLI callers need it without reaching into `shared/workflow`.
- [ ] Success criteria: `pnpm -s type-check` fails at unupdated call sites that treat the result as a bare `string`, proving the compiler now tracks the error.

### Phase 4: Update pilot callers and tests

Propagate the union through internal callers. At CLI and workflow edges, either return/propagate the error or throw/map it where the surrounding API still uses throw-based failure.

```ts
// packages/libretto/src/cli/commands/profiles.ts
const profileName = normalizeProfileName(input.profileName);
if (profileName instanceof InvalidProfileNameError) throw profileName;
// profileName is string below
```

```ts
// packages/libretto/test/profiles.spec.ts
expect(normalizeProfileName("twitter")).toBe("twitter");
expect(normalizeProfileName("../twitter")).toBeInstanceOf(InvalidProfileNameError);
```

- [ ] Update every `normalizeProfileName` caller listed in Important files so each result is checked with `instanceof` before use.
- [ ] Prefer `if (result instanceof InvalidProfileNameError) return result` when the caller can widen its own return type in this phase; otherwise `throw result` at a throw-based boundary (CLI command handlers, current workflow parsers).
- [ ] Update `packages/libretto/test/profiles.spec.ts` to assert returned errors instead of `toThrow`.
- [ ] Read `docs/tests-guide.md` before editing tests; keep assertions on behavior and message keywords, not formatting trivia.
- [ ] Run `pnpm -s type-check` and the targeted profiles test file.
- [ ] Success criteria: type-check passes; invalid names return `InvalidProfileNameError`; valid names still normalize; CLI profile flows still fail with the same message keywords when given bad names.

### Phase 5: Record the boundary mapping pattern for later migrations

Capture the adapter rule next to the skill/docs so the next module does not invent a third style. No further code migration in this phase.

```ts
// Boundary sketch only — do not change ToolResult in this spec
const name = normalizeProfileName(input);
if (name instanceof InvalidProfileNameError) {
  return {
    ok: false,
    error: `${name.message}. Pass a profile name with letters, numbers, dots, underscores, or dashes.`,
  };
}
```

- [ ] Add a short "Boundary mapping" subsection under the new AGENTS.md errors-as-values section showing: internal `T | Error` → agent `{ ok: false, error }` string with a next step.
- [ ] Explicitly list frozen envelopes: `ToolResult` / `ToolErrorResult`, daemon exec `{ ok: false, message, output? }`.
- [ ] Success criteria: docs state that future migrations must keep those envelopes unless a new breaking-change spec says otherwise.

## Verification (end-to-end for this spec)

- [ ] `pnpm -s type-check` passes after Phases 3–4.
- [ ] Targeted test for profile name validation passes (`profiles.spec.ts` or the package's usual test filter for that file).
- [ ] Root `AGENTS.md` and `.agents/skills/errore/SKILL.md` agree on convention-only adoption and boundary exceptions.
- [ ] `git grep` / review confirms no new `errore` dependency in any `package.json`.
