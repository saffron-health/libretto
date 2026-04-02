## Problem overview

Libretto's current onboarding is split across two commands in a way that is hard to understand and easy to break. `npx libretto setup` installs browsers, syncs skills, and can write provider credentials to `.env`, but it does not persist the chosen snapshot-analysis model to `.libretto/config.json`; only `npx libretto ai configure ...` does that. As a result, first-time setup can leave the workspace in an implicit env-driven state, rerunning setup does not clearly report the configured model, and a pinned model with missing credentials is not repaired cleanly.

The current UX also lacks a simple way to inspect overall workspace readiness. Users need a lightweight status view that shows the effective AI configuration and currently open sessions without rerunning the full onboarding flow.

## Solution overview

Make `npx libretto setup` own first-run AI onboarding for the default provider models that Libretto already supports. When setup finds usable credentials or the user enters them during onboarding, it should write `.libretto/config.json` so the active model is explicit, reruns should report the configured model and how to change it, and broken configured-provider states should offer an interactive repair path instead of generic failure text.

Add a small `npx libretto status` command that reports AI configuration health and open sessions. Keep `npx libretto ai configure ...` as the explicit advanced path for changing providers or selecting a custom provider/model string.

## Goals

- `npx libretto setup` leaves the workspace fully ready for snapshot analysis whenever matching credentials already exist or the user provides them during setup.
- `npx libretto setup` writes `.libretto/config.json` with an explicit default model for the selected provider instead of leaving the runtime model implicit in env auto-detection.
- Re-running `npx libretto setup` on a healthy workspace reports the configured model and the command to change it instead of re-prompting for AI setup.
- If `.libretto/config.json` pins a provider whose credentials are missing, setup offers a repair flow that lets the user either provide the matching credential or switch to another supported provider.
- `npx libretto status` reports current AI configuration health and currently open sessions in the workspace.
- Existing env-based auto-detection remains as a backward-compatible runtime fallback for users who have not rerun setup yet.

## Non-goals

- No migrations or backfills.
- No new provider support or custom model picker inside `setup`; setup only works with the existing default provider shorthands.
- No non-interactive CI/bootstrap redesign or new unattended flags.
- No redesign of browser install, Playwright cache management, or postinstall behavior beyond preserving current setup behavior.
- No changes to viewport, profiles, or session execution semantics beyond reporting open sessions in `status`.
- No new top-level `configure` or `doctor` command in this spec.

## Future work

- None yet. Add follow-up items discovered during implementation.

## Important files/docs/websites for implementation

- `packages/libretto/src/cli/commands/setup.ts` — current setup flow for browser install, skill sync, interactive credential prompts, and status-only output.
- `packages/libretto/src/cli/core/ai-config.ts` — shared config schema and the existing `ai configure` read/write/show/clear behavior that setup should reuse.
- `packages/libretto/src/cli/core/snapshot-api-config.ts` — env loading, config-first model resolution, provider priority, and user-facing snapshot setup error messages.
- `packages/libretto/src/shared/llm/client.ts` — provider parsing and credential detection rules that determine whether setup/status should consider a provider ready.
- `packages/libretto/src/cli/core/context.ts` — `.libretto/config.json`, `.libretto/sessions`, and other workspace path constants used by setup and status.
- `packages/libretto/src/cli/core/session.ts` — session-state discovery and validation helpers that the new `status` command should reuse.
- `packages/libretto/src/cli/router.ts` — CLI route registration for adding `status`.
- `packages/libretto/src/cli/cli.ts` — root help/examples that should mention the new status command and clarified setup behavior.
- `packages/libretto/test/basic.spec.ts` — subprocess coverage for `setup` messaging, skill sync, and help output.
- `packages/libretto/test/stateful.spec.ts` — stateful CLI behavior tests that should cover config persistence and the new `status` command.
- `packages/libretto/test/snapshot-api-config.spec.ts` — focused model-resolution tests for config/env precedence and missing-credential errors.
- `packages/libretto/test/fixtures.ts` — subprocess test harness used for setup/status scenarios.
- `packages/libretto/README.template.md` — source of truth for README installation/configuration text; must be updated, then mirrored.
- `packages/libretto/skills/libretto/SKILL.md` — source-of-truth Libretto skill docs that currently describe setup at a high level.
- `packages/libretto/skills/libretto/references/configuration-file-reference.md` — config reference that should explain setup-owned AI pinning and the new status command.
- `packages/libretto/scripts/postinstall.mjs` — existing automatic Chromium/skill install behavior to leave unchanged in this spec.
- https://playwright.dev/docs/browsers — Playwright browser installation guidance relevant to keeping current Chromium install behavior documented correctly.

## Implementation

### Phase 1: Add a reusable AI setup health resolver

Introduce one shared resolver that explains the workspace's AI setup state in terms setup and status can both print. Keep it focused on the cases users actually hit: healthy config, healthy env-only fallback, configured provider missing credentials, invalid config, and fully unconfigured.

```ts
type AiSetupStatus =
  | { kind: "ready"; model: string; source: "config" | `env:auto-${string}` }
  | { kind: "configured-missing-credentials"; model: string; provider: Provider }
  | { kind: "invalid-config"; message: string }
  | { kind: "unconfigured" };

function resolveAiSetupStatus(): AiSetupStatus {
  const config = readAiConfigSafely();
  if (config.kind === "invalid") return { kind: "invalid-config", message: config.message };
  return resolveConfiguredOrEnvStatus(config.value);
}
```

- [ ] Add a small shared helper module for AI setup/status resolution instead of duplicating branching in `setup.ts` and the new `status` command.
- [ ] Represent the configured-provider-missing-credentials case explicitly so setup can offer repair guidance instead of falling back to the generic "No snapshot API credentials detected" message.
- [ ] Treat invalid `.libretto/config.json` as its own state and never collapse it into a ready env-only path.
- [ ] Add focused tests for: env-only ready, config ready, configured provider missing credentials, invalid config, and fully unconfigured.
- [ ] Success criteria: `packages/libretto/test/snapshot-api-config.spec.ts` (or a new focused resolver test) fails if a pinned OpenAI model with only an Anthropic key is reported as ready.

### Phase 2: Make setup persist the default model and print an idempotent healthy summary

Once setup can explain workspace state, make it own the first successful model pinning step. This phase should keep the current browser/skill work intact while making the AI portion explicit, idempotent, and easy to understand when rerun.

```ts
function ensurePinnedDefaultModel(status: AiSetupStatus) {
  if (status.kind === "ready" && status.source !== "config") {
    writeAiConfig(status.model);
    return { ...status, source: "config" as const };
  }
  return status;
}
```

- [ ] Update setup so that when usable credentials already exist and no AI model is pinned yet, it writes `.libretto/config.json` with the resolved default model.
- [ ] Update the interactive provider-selection path so that a newly entered credential writes both the env var and the provider's default model to config.
- [ ] When setup is already healthy with config + matching credentials, print the configured model, config path, and `npx libretto ai configure ...` change guidance instead of prompting again.
- [ ] Do not print a healthy summary when the AI config is invalid.
- [ ] Add a subprocess test for `setup --skip-browsers` with `OPENAI_API_KEY` already present that verifies `.libretto/config.json` is created and the output shows the configured model.
- [ ] Add a rerun test that verifies healthy setup output includes the model and how to change it with `npx libretto ai configure ...`.
- [ ] Success criteria: a workspace with only `OPENAI_API_KEY` set becomes config-backed after one `setup --skip-browsers` run, and a second run does not re-enter the AI onboarding path.

### Phase 3: Add interactive repair flows for broken configured-provider states

Handle the main broken case directly in setup: config pins one provider, but matching credentials are missing. Keep the flow minimal by supporting only two repair actions in v1: enter the missing configured-provider credential, or switch to another provider and rewrite both env + config.

```ts
type RepairChoice = "enter-matching-credential" | "switch-provider" | "skip";

function buildRepairChoices(status: AiSetupStatus): RepairChoice[] {
  if (status.kind !== "configured-missing-credentials") return ["skip"];
  return ["enter-matching-credential", "switch-provider", "skip"];
}
```

- [ ] When setup sees `configured-missing-credentials`, print a provider-specific explanation and prompt the user to either enter the missing matching credential, switch providers, or skip.
- [ ] Reuse the existing provider list/default model map for the switch-provider path so switching updates `.env` and `.libretto/config.json` together.
- [ ] If the AI config is invalid, let setup continue into provider selection and overwrite only the `ai` portion with a valid provider default on success.
- [ ] Extract the repair-plan decisions into testable helpers instead of trying to cover the full TTY loop only through subprocess tests.
- [ ] Add focused tests for: pinned OpenAI + missing OpenAI key + Anthropic key present, and invalid config + successful provider reselection.
- [ ] Success criteria: setup no longer reports a generic missing-credentials message for a pinned provider mismatch; it names the configured provider and the concrete recovery options.

### Phase 4: Add a `status` command for AI configuration and open sessions

Expose a read-only summary command so users can inspect workspace readiness without rerunning setup. Keep the output small: one AI section and one sessions section, with sessions limited to currently open/live session processes.

```ts
type StatusSummary = {
  ai: AiSetupStatus;
  sessions: Array<{ name: string; status?: SessionStatus; pid?: number; port: number }>;
};

async function runStatus() {
  const summary = readStatusSummary();
  printAiStatus(summary.ai);
  printOpenSessions(summary.sessions);
}
```

- [ ] Add `status` to the CLI router and root help text.
- [ ] Print AI status using the shared resolver from Phase 1, including configured model, config path when present, and the change command.
- [ ] List open sessions by reading session state files and filtering to live processes, then print session name, status, and local endpoint details.
- [ ] Print `No open sessions.` when no live sessions exist.
- [ ] Add a stateful subprocess test that opens a headless session, runs `status`, and verifies the configured AI model and session name both appear.
- [ ] Success criteria: `status` gives a useful read-only summary on a healthy workspace without triggering browser install, skill sync, or setup prompts.

### Phase 5: Update docs and targeted CLI coverage

Bring the docs and tests back in sync with the new onboarding contract. Keep this phase limited to user-facing text and targeted verification, not additional behavior changes.

- [ ] Update `packages/libretto/README.template.md` so installation/configuration explains that `setup` now pins the default model when credentials are available and that `ai configure` remains the advanced/manual override path.
- [ ] Update `packages/libretto/skills/libretto/SKILL.md` and `packages/libretto/skills/libretto/references/configuration-file-reference.md` to mention the new `status` command and clarified setup behavior.
- [ ] Run `pnpm sync:mirrors` after doc changes.
- [ ] Add/update targeted CLI tests in `packages/libretto/test/basic.spec.ts` and `packages/libretto/test/stateful.spec.ts` for the new help text and status command.
- [ ] Run `pnpm --filter libretto type-check`.
- [ ] Run `pnpm --filter libretto exec vitest run test/basic.spec.ts test/stateful.spec.ts test/snapshot-api-config.spec.ts`.
- [ ] Success criteria: docs consistently describe setup as the first-run onboarding path, `ai configure` as the explicit override path, and `status` as the read-only inspection command.
