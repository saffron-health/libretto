## Problem overview

Integration creation can involve a manual login during browser exploration, but `libretto run` currently launches a fresh browser context that does not reuse the saved login profile. This causes integrations that worked during setup to fail at runtime due to missing authenticated state.

## Solution overview

Add an explicit `LibrettoWorkflow` class to carry integration metadata and run logic together, with `authProfile.type = "local"` support in v1. When `libretto run` executes a `LibrettoWorkflow` that declares a local auth profile domain, it resolves `.libretto/profiles/<hostname>.json` and loads it as Playwright `storageState` before creating the browser context. If the profile is declared but missing, fail fast with an actionable error.

## Goals

- Integrations can declare `authProfile` metadata with `type: "local"` and `domain` through a typed `LibrettoWorkflow` export.
- `libretto run` automatically loads `.libretto/profiles/<domain>.json` when local auth metadata is present.
- Runtime fails early with a clear error when declared local auth profile data is unavailable.
- Authoring/generation guidance prompts for auth handling and records local auth metadata when a saved profile is chosen.
- User-facing guidance clearly warns that local profiles are machine-local and may expire/re-authenticate.

## Non-goals

- No migrations or backfills.
- No support for optional auth profiles (`required` flag).
- No multi-account profile keying beyond hostname domain in v1.
- No integration with external credential managers in this spec.
- No `authProfile.type = "cloud"` implementation in this spec.

## Future work

- Add `authProfile.type = "cloud"` backed by Libretto Cloud / Kernel auth.
- Add multi-account profile aliases for multiple identities on the same hostname.
- Add tooling to refresh/validate stale local profiles proactively.

## Important files/docs/websites for implementation

- `packages/libretto/src/commands/execution.ts` - `run` command/module loading path; add auth metadata resolution and fail-fast behavior.
- `packages/libretto/src/run/browser.ts` - browser context creation; accept optional `storageState` input so runtime can preload auth state.
- `packages/libretto/src/run/api.ts` - export surface for updated browser launch args.
- `packages/libretto/src/index.ts` - export workflow/auth metadata helper if introduced for integration authoring ergonomics.
- `packages/libretto/src/core/context.ts` - source of `.libretto/profiles` location and path conventions.
- `packages/libretto/src/cli.ts` - usage/help text updates for `run` auth profile behavior.
- `packages/libretto/src/cli-basic.test.ts` - subprocess-level guard and usage behavior assertions.
- `packages/libretto/src/test-fixtures.ts` - fixture helpers for creating integration/profile files in isolated workspaces.
- `packages/libretto/skills/libretto-network-skill/SKILL.md` - update auth prompt guidance during workflow creation.
- `packages/libretto/skills/original-skill/SKILL.md` - keep legacy skill variant aligned with new auth flow.

## Implementation

### Phase 1: Add local auth profile contract and loader plumbing

- [x] Add a `LibrettoWorkflow` class that stores `{ authProfile?: { type: "local"; domain: string } }` metadata and a `run(ctx, input)` handler.
- [x] Add/extend a `workflow(meta, fn)` helper that returns a `LibrettoWorkflow` instance.
- [x] Update `libretto run` loader to require that the selected export is a `LibrettoWorkflow` instance.
- [x] Read auth metadata only from the `LibrettoWorkflow` instance.
- [x] Extend `launchBrowser` args to accept optional `storageStatePath` and pass it to `browser.newContext({ storageState })` when provided.
- [x] Ensure domain normalization uses hostname (e.g., `app.example.com`) and maps to `.libretto/profiles/<domain>.json`.
- [x] Success criteria: subprocess tests confirm `run` returns a clear error when the export is not a Libretto workflow instance, and type checks pass for the new workflow + storage-state plumbing.

### Phase 2: Enforce fail-fast runtime behavior for declared local auth

- [x] In `run`, when `authProfile.type === "local"` is declared, verify the corresponding profile file exists before launching the browser.
- [x] Return a clear error that includes the expected profile path and next action (`open` -> manual login -> `save`).
- [x] Keep behavior unchanged for integrations with no `authProfile` metadata.
- [x] Success criteria: subprocess CLI test with interactive session permission and an integration that declares local auth fails before browser launch when profile file is missing, with deterministic error text.

### Phase 3: Authoring and prompt guidance updates

- [x] Update integration generation/prompt guidance to ask for auth handling when login is required.
- [x] Replace current guidance that forbids discussing saved sessions; instruct agents to offer local profile saving when appropriate.
- [x] Require warning text in generated workflow guidance: local profiles are machine-local and may expire, requiring re-login.
- [x] Success criteria: skill docs and CLI/help text include the new local-profile warning and no longer conflict with the runtime behavior.

### Phase 4: End-to-end verification and docs alignment

- [x] Add/adjust tests for: metadata present + missing profile error, metadata absent default behavior, and storageState handoff path.
- [x] Run `pnpm test`.
- [x] Run `pnpm type-check`.
- [x] Success criteria: all listed test/type-check commands pass and spec changes are reflected in relevant usage docs.
