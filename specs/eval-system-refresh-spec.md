## Problem overview

The current eval system does not give a trustworthy signal about Libretto agent quality. The useful eval cases are mixed with an unnecessary smoke test, the agent harness is tied directly to the Claude Agent SDK instead of Pi, authenticated cases mention auth profiles only in prompt text, private maintainer-only cases have no local home, and reports omit the metrics needed to understand cost, runtime, token use, and tool behavior.

## Solution overview

Use the Pi SDK for the agent under evaluation and replace Vitest with a small purpose-built eval runner. Eval files register cases through `evalCase({ name, authProfile? }, run)`; `authProfile` is a required domain when present. The eval CLI imports discovered eval files, collects registered cases, applies `.only` and simple filters, preflights required auth profiles, runs cases, and writes artifacts. Auth profiles live in gitignored `evals/profiles/`, private eval cases live in gitignored `evals/private/`, run artifacts live in gitignored `evals/runs/`, and `pnpm evals` runs every discovered eval case. Model selection stays harness-level: default to `openai/gpt-5.5` with medium reasoning, and allow temporary overrides with `LIBRETTO_EVAL_MODEL=<provider/model-id>`.

## Goals

- Maintainers can run all available evals with `pnpm evals`.
- The three current basic eval cases remain the core suite: LinkedIn generation/amendment, broken-selector debugging, and network conversion.
- The smoke eval is removed because it only validates harness wiring.
- The eval harness uses the Pi SDK instead of `@anthropic-ai/claude-agent-sdk`.
- Maintainers get `openai/gpt-5.5` with medium reasoning by default, with temporary model overrides available via `LIBRETTO_EVAL_MODEL=<provider/model-id>`.
- Checked-in evals can require local auth profiles without becoming private.
- Auth requirements are defined in code with `evalCase({ name, authProfile })`, not buried only in prompt text.
- `pnpm evals profiles status` reports which auth profiles are required and which are present locally.
- `pnpm evals profiles login <domain>` creates or refreshes a local eval auth profile.
- Eval reports include all available session metrics: tokens in, tokens out, cache tokens, cost, wall time, model usage, turns, tool calls, permission denials, and scoring results.
- Scoring results are recorded, not asserted. `pnpm evals` should fail only for real execution/setup errors such as harness crashes, missing required auth profiles, malformed result records, or zero completed records.

## Non-goals

- No migrations or backfills.
- No hosted eval registry or hosted eval service.
- No profile sharing, pulling, or pushing in v1.
- No automatic login bypass, CAPTCHA solving, MFA automation, or credential harvesting.
- No suite taxonomy or suite-selection flags in v1; if `evals/private/` exists, its cases run too.
- No per-case model selection in v1.
- No general-purpose test-runner features in v1: no watch mode, snapshots, nested suites, retries, custom reporters, or worker pool.

## Future work

- Profile sharing can be added later if maintainers need it.
- Baseline comparison can be wired after the eval records and metrics are stable.
- CI policy for auth-required evals needs a separate decision if CI should run LinkedIn without a local maintainer profile.
- Fixture-backed versions of the live-site evals may be useful after the MVP is working, but v1 keeps the three current useful cases.

## Current eval case audit

- `evals/smoke.eval.ts` / `runs a single-turn eval with libretto skill context` should be removed. It verifies that the harness can inject skill docs and score a response, but it is not a product-quality eval.
- `evals/basic.eval.ts` / `linkedin scrape generation and amendment` should stay checked in and declare `authProfile: "linkedin.com"`. The profile becomes a preflight requirement instead of a prompt-only convention.
- `evals/basic.eval.ts` / `broken selector debugging on a government website` should stay as a core eval. It exercises run-diagnose-edit-rerun behavior on a broken workflow.
- `evals/basic.eval.ts` / `convert browser workflow to network requests` should stay as a core eval. It exercises code conversion from browser DOM scraping to a network-first implementation.

## Important files/docs/websites for implementation

- `evals/harness.ts` — current Claude Agent SDK harness; replace with a Pi SDK harness.
- `evals/fixtures.ts` — temp workspace creation, Libretto skill setup, copied reference fixtures, and current harness fixture setup.
- `evals/scoring.ts` — current score-record writer and assertion helper; replace assertion-oriented behavior with richer result recording.
- `evals/vitest.config.ts` — current Vitest configuration; remove after the custom eval runner replaces Vitest.
- `evals/eval-case.ts` — new eval-case registry and `evalCase.only` implementation.
- `evals/cli.ts` — new eval CLI that discovers cases, preflights profiles, runs cases, and writes artifacts.
- `evals/basic.eval.ts` and `evals/smoke.eval.ts` — current eval cases to convert/remove.
- `evals/references/` — checked-in fixture workflows used by the basic evals.
- `evals/package.json` — route `pnpm evals ...` to the eval CLI, add `tsx`, and remove Vitest after the custom runner is wired.
- `package.json` and `turbo.json` — root `pnpm evals` wiring and Turbo task configuration.
- `.github/workflows/evals.yml` — CI command, summary, artifact upload, non-strict reporting, and zero-record enforcement.
- `.gitignore` — add `evals/profiles/`, `evals/private/`, and `evals/runs/`.
- `packages/libretto/scripts/summarize-evals.mjs` — extend markdown/JSON summaries with metrics and zero-record validation.
- `packages/dev-tools/src/tmp-workspace.ts` — shared temp workspace setup that creates `.agents/skills/`, `.libretto/profiles/`, and installs local Libretto.
- `packages/libretto/src/cli/commands/browser.ts` and `packages/libretto/src/cli/core/browser.ts` — existing `open`, `save`, profile normalization, and profile-save behavior reused by `pnpm evals profiles login <domain>`.
- `benchmarks/webVoyager/agentic-evaluator/runner.ts` — existing in-repo Pi SDK usage with `createAgentSession`, custom model selection, tools, event capture, timeouts, and token/cost summarization.
- `benchmarks/webVoyager/runner.ts` — richer Pi event usage summarization for input/output/cache token metrics.
- Pi SDK docs: `/Users/tanishqkancharla/.nvm/versions/node/v23.7.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md` — `createAgentSession`, model registry, tools, events, sessions, settings, and resource loading.
- Pi SDK examples: `/Users/tanishqkancharla/.nvm/versions/node/v23.7.0/lib/node_modules/@mariozechner/pi-coding-agent/examples/sdk/` — custom model, tools, skills, sessions, and full-control examples.
- `tsx` package docs: used only to run the TypeScript eval CLI and import TypeScript eval files without a separate build step.

## Implementation

## Run artifact and metrics storage

Every eval invocation creates one run directory. Locally, the default is `evals/runs/<run-id>/`; CI should pass `--output <path>` to place the same structure under the runner temp directory. The whole `evals/runs/` directory is gitignored because raw transcripts can contain private site data, local paths, and auth-adjacent output.

```txt
evals/runs/2026-05-05T12-30-00Z-anthropic-claude-opus-4-5/
  run.json
  summary.json
  summary.md
  cases/
    linkedin-scrape-generation-and-amendment/
      result.json
      agent-events.jsonl
      agent-transcript.md
      judge-events.jsonl
      judge-transcript.md
```

- `run.json` stores run-level metadata: run ID, started/finished timestamps, git SHA when available, CLI args, selected model, output directory, and totals.
- `summary.json` and `summary.md` store aggregated score and metrics for humans and CI comments.
- Each `cases/<case-id>/result.json` stores case metadata, execution status, score, agent metrics, judge metrics, tool counts, and links to local artifacts. Low scores are data in this file, not test failures.
- Case execution status is independent from score: `completed` means the eval ran and recorded results, while `error` means setup, agent execution, scoring infrastructure, or artifact writing failed.
- `agent-events.jsonl` and `judge-events.jsonl` store raw Pi events for debugging.
- `agent-transcript.md` and `judge-transcript.md` store readable transcripts used for review.
- CI uploads `summary.*` and redacted result records; raw profile files are never copied into the run directory or uploaded.

### Phase 1: Remove eval code and cases we are not keeping

Start by cutting the current suite down to the three useful cases so later harness and CLI work has a small, clear target. Keep the old harness temporarily if needed to avoid mixing deletion with the Pi SDK replacement.

```ts
// Remaining checked-in cases after this phase:
// - linkedin scrape generation and amendment
// - broken selector debugging on a government website
// - convert browser workflow to network requests
```

- [x] Delete `evals/smoke.eval.ts`.
- [x] Keep the three `evals/basic.eval.ts` cases as the only checked-in eval cases.
- [x] Remove smoke-only assertions and summary expectations if any are added elsewhere.
- [x] Verify `pnpm evals` still starts the eval runner, even if later phases change the harness.
- [x] Success criteria: searching `evals/` shows only the three basic eval cases as checked-in eval cases.

### Phase 2: Replace the agent harness with the Pi SDK

Swap `@anthropic-ai/claude-agent-sdk` for the Pi SDK in the eval harness. The Pi session should run in the eval temp workspace so it discovers the Libretto skill copied by `createTmpWorkspace` and resolves tools relative to the isolated workspace.

```ts
type EvalModelSelector = `${string}/${string}`;
const DEFAULT_EVAL_MODEL: EvalModelSelector = "openai/gpt-5.5";
const DEFAULT_THINKING_LEVEL = "medium";

async function createPiEvalSession(opts: {
  cwd: string;
  model?: EvalModelSelector;
}) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = resolvePiModel(modelRegistry, opts.model ?? DEFAULT_EVAL_MODEL);
  const agentDir = join(opts.cwd, ".pi");
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
  });
  await resourceLoader.reload();

  return createAgentSession({
    cwd: opts.cwd,
    agentDir,
    model,
    thinkingLevel: DEFAULT_THINKING_LEVEL,
    authStorage,
    modelRegistry,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(opts.cwd),
    tools: ["read", "write", "edit", "bash"],
  });
}

function formatMessagesForEvaluation(messages: AgentSession["messages"]) {
  return serializeConversation(convertToLlm(messages)).trim();
}
```

- [x] Add `@mariozechner/pi-coding-agent` to `evals/package.json` and remove the direct `@anthropic-ai/claude-agent-sdk` dependency after the replacement is complete.
- [x] Use a Pi SDK version whose built-in model registry includes `openai/gpt-5.5`.
- [x] Implement a `PiEvalHarness` that supports the current `harness.send(...)` and multi-turn session behavior.
- [x] Use `SessionManager.inMemory(evalWorkspaceDir)` so eval runs do not depend on persistent Pi session files.
- [x] Use an eval-workspace-local Pi `agentDir` and an isolated `DefaultResourceLoader` so eval runs do not depend on global extensions or persistent local Pi state.
- [x] Let `DefaultResourceLoader` discover `.agents/skills` in the temp workspace instead of manually appending Libretto skill markdown to the system prompt.
- [x] Use only the Pi SDK tools needed by the evals: `read`, `write`, `edit`, and `bash`.
- [x] Default evaluated agent and judge sessions to `openai/gpt-5.5` with medium reasoning.
- [x] Resolve the default or `LIBRETTO_EVAL_MODEL="provider/model-id"` selector through `ModelRegistry.find(provider, modelId)` and pass it into every evaluated Pi agent and judge session for that run.
- [x] Keep the scoring API shape (`response.score([...])`) but implement judge calls through Pi as well.
- [x] Make scoring record verdicts and reasons without throwing when criteria fail.
- [x] Remove `assertPerfectScore`; eval cases should call `recordScore` for informational score records.
- [x] Capture Pi `AgentSessionEvent` records for raw transcripts and metrics.
- [x] Use Pi SDK conversation helpers (`convertToLlm` and `serializeConversation`) for scoring transcripts instead of custom message parsing.
- [x] Keep `evals/package.json` calling Vitest directly for Phase 2; do not add a `--model` wrapper or custom eval CLI before Phase 3.
- [x] Success criteria: one existing basic eval can run end-to-end through Pi SDK with the same prompt text.
- [x] Success criteria: `LIBRETTO_EVAL_MODEL=<provider/model-id> pnpm evals` changes the Pi model used for evaluated agent sessions.

### Phase 3: Replace Vitest with a purpose-built eval runner

Add the simple `evalCase` registry and a small `pnpm evals ...` CLI that imports eval files, collects registered cases, applies local filters, runs cases, and writes execution status. This phase should not introduce auth or private-case behavior yet; it should make the normal non-auth eval flow pleasant and focused.

```ts
type EvalCaseOptions = {
  name: string;
  authProfile?: string;
};

export const evalCase = Object.assign(
  (options: EvalCaseOptions, run: EvalCaseFn) => registerEvalCase(options, run),
  {
    only: (options: EvalCaseOptions, run: EvalCaseFn) =>
      registerEvalCase(options, run, { only: true }),
  },
);
```

- [ ] Add `.gitignore` entries for `evals/profiles/`, `evals/private/`, and `evals/runs/`.
- [ ] Add `evalCase({ name, authProfile? }, run)` in `evals/` backed by an in-memory registry.
- [ ] Implement `evalCase.only({ name, authProfile? }, run)` by registering the case with an `only` flag.
- [ ] Add a discovery function that imports checked-in `evals/**/*.eval.ts` files and excludes `evals/private/` until Phase 5.
- [ ] Add `tsx` to `evals/package.json` and use it to run the TypeScript eval CLI and import TypeScript eval files.
- [ ] Convert the three cases in `evals/basic.eval.ts` to `evalCase`.
- [ ] Replace the Vitest fixture extension in `evals/fixtures.ts` with a runner-owned `createEvalContext(case)` helper that creates the temp workspace, copy-reference helper, paths, and `PiEvalHarness` for each case.
- [ ] Add an eval CLI script in `evals/`.
- [ ] Change `evals/package.json` so its `evals` script calls the eval CLI.
- [ ] Remove Vitest from `evals/package.json` and delete `evals/vitest.config.ts` after the custom runner is wired.
- [ ] Support `pnpm evals` and `pnpm evals run` as aliases for running all evals.
- [ ] Keep model selection in the Pi SDK harness, defaulting to `openai/gpt-5.5` with medium reasoning and accepting `LIBRETTO_EVAL_MODEL=<provider/model-id>` for temporary overrides.
- [ ] Support `pnpm evals --output <dir>` and `pnpm evals run --output <dir>` as runner-level run artifact output selection.
- [ ] Support file filters as positional arguments and `-t` / `--testNamePattern` for case-name filtering.
- [ ] Run cases serially by default; do not add a worker pool in v1.
- [ ] Treat low scores as recorded data, not CLI failures.
- [ ] Success criteria: `pnpm evals` runs all three converted cases.
- [ ] Success criteria: `evalCase.only` runs only that case locally.
- [ ] Success criteria: `pnpm evals run -t network` focuses by test name.

### Phase 4: Add authenticated eval support

When a case declares `authProfile`, require `evals/profiles/<domain>.json` and copy it into the temporary workspace profile location before creating the agent harness. Add status and login commands for local profile management.

```ts
async function provisionAuthProfile(domain: string, evalWorkspaceDir: string) {
  const source = join(repoRoot, "evals", "profiles", `${domain}.json`);
  if (!existsSync(source)) {
    throw new Error(
      `Missing eval auth profile for ${domain}. ` +
        `Create it with: pnpm evals profiles login ${domain}`,
    );
  }

  await copyFile(
    source,
    join(evalWorkspaceDir, ".libretto", "profiles", `${domain}.json`),
  );
}
```

- [ ] Add `authProfile: "linkedin.com"` to the LinkedIn case.
- [ ] Normalize auth profile domains the same way Libretto does for `--auth-profile` where possible.
- [ ] Look up profiles only in `evals/profiles/<domain>.json`.
- [ ] Copy the profile into `<workspace>/.libretto/profiles/<domain>.json` before constructing `PiEvalHarness`.
- [ ] Fail required missing profiles before launching Pi with a message that includes `pnpm evals profiles login <domain>`.
- [ ] Implement `pnpm evals profiles status` by importing discovered eval files and reading required auth profiles from the eval-case registry.
- [ ] Fail registration when `authProfile` is present but is not a non-empty string.
- [ ] Report each required domain, the cases that require it, whether `evals/profiles/<domain>.json` exists, and the next command to create it.
- [ ] Implement `pnpm evals profiles login <domain>` as an interactive local command that opens `https://<domain>` headed, waits for the maintainer to finish login, saves the Libretto profile, copies it to `evals/profiles/<domain>.json`, and closes the session.
- [ ] Ensure profile JSON is never written to score records, summaries, or CI artifacts.
- [ ] Success criteria: LinkedIn fails before launching Pi when `evals/profiles/linkedin.com.json` is missing.
- [ ] Success criteria: `profiles status` lists `linkedin.com` as missing/present based on `evals/profiles/linkedin.com.json`.
- [ ] Success criteria: `profiles login linkedin.com` creates or refreshes `evals/profiles/linkedin.com.json` after manual login.

### Phase 5: Add private eval support

Enable maintainer-local private cases by relying on the same `evalCase` API and custom discovery. There is no separate suite mechanism: private cases are just gitignored eval files that run when present.

```ts
// evals/private/some-private-case.eval.ts
import { evalCase } from "../eval-case.js";

evalCase(
  { name: "private portal workflow", authProfile: "portal.example.com" },
  async ({ harness }) => {
    // Private maintainer-only eval.
  },
);
```

- [ ] Ensure `evals/private/**/*.eval.ts` is discovered by the eval CLI when the directory exists.
- [ ] Document that `evals/private/` is always gitignored and may contain ordinary `evalCase` files.
- [ ] Make `profiles status` discover and import both checked-in evals and `evals/private/` when present.
- [ ] Confirm private cases can use the same `authProfile` provisioning from `evals/profiles/`.
- [ ] Add no pull/push/sync behavior for profiles or private cases in v1.
- [ ] Success criteria: adding `evals/private/example.eval.ts` makes `pnpm evals` run it without any suite flag.
- [ ] Success criteria: deleting `evals/private/` leaves `pnpm evals` running only checked-in cases.

### Phase 6: Record full eval metrics and artifacts

Persist metrics from both the Pi agent session and the Pi judge session instead of only pass/fail criteria. Store complete raw artifacts locally, then build a redacted summary for CI comments and uploaded artifacts.

```ts
type EvalMetrics = {
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  totalCostUsd: number | null;
  toolCalls: Record<string, number>;
};
```

- [ ] Add an eval run recorder that wraps each `harness.send()` and `response.score()` call.
- [ ] Create one run directory per invocation under `evals/runs/<run-id>/` by default, or under the CLI-provided `--output <dir>`.
- [ ] Write run-level `run.json`, `summary.json`, and `summary.md` files.
- [ ] Write per-case `cases/<case-id>/result.json` records.
- [ ] Persist Pi `message_end` usage fields when available: input tokens, output tokens, cache read/write tokens, total tokens, and cost.
- [ ] Persist model/provider, response ID, stop reason, turn count, session ID, and error state when available from Pi events/messages.
- [ ] Count tool calls from `tool_execution_start` / `tool_execution_end`; include total calls, counts by tool name, and failed calls.
- [ ] Store full raw event JSONL and formatted transcript artifacts under a per-case artifact directory.
- [ ] Store judge prompt/model/result/rationale and judge metrics separately from agent metrics.
- [ ] Redact known sensitive values before writing CI-uploaded summaries.
- [ ] Success criteria: each score record includes duration, model usage, token totals, cost estimate, turns, and tool-call counts when Pi provides them.
- [ ] Success criteria: a run with missing usage metadata records nullable metrics instead of crashing.
- [ ] Success criteria: `pnpm evals --output temp/eval-run` writes `run.json`, `summary.json`, and per-case `result.json` records under `temp/eval-run`.

### Phase 7: Update summaries, CI, and docs

Make eval results readable and enforce that CI cannot silently pass when the runner produced no completed records. Keep docs aligned with the actual local profile and private-case behavior.

```md
# Eval Summary

- Run ID: `2026-05-05T12-30-00Z-anthropic-claude-opus-4-5`
- Model: `anthropic/claude-opus-4-5`
- Duration: `18m 21s`
- Cases completed: `3`
- Cases errored: `0`
- Score: `8/11 criteria` (`72.73%`)

Scoring is informational. Low scores do not fail the eval command; setup or runtime errors do.

## Metrics

- Total cost: `$3.2145`
- Total tokens: `412,903`
- Input tokens: `351,120`
- Output tokens: `42,883`
- Cache read tokens: `18,900`
- Tool calls: `64`

## Cases

| Case | Status | Score | Duration | Cost | Tokens | Tool calls | Artifacts |
|---|---|---:|---:|---:|---:|---:|---|
| `linkedin scrape generation and amendment` | completed | `4/6` | `11m 42s` | `$2.1012` | `241,009` | `39` | `cases/linkedin-scrape-generation-and-amendment/result.json` |
| `broken selector debugging on a government website` | completed | `4/4` | `4m 08s` | `$0.7210` | `102,440` | `17` | `cases/broken-selector-debugging-on-a-government-website/result.json` |
| `convert browser workflow to network requests` | completed | `0/1` | `2m 31s` | `$0.3923` | `69,454` | `8` | `cases/convert-browser-workflow-to-network-requests/result.json` |
```

- [ ] Keep `summary.md` to the top-level run summary, metrics section, and cases table; put detailed failed criteria and transcripts in per-case artifacts instead.
- [ ] Extend `packages/libretto/scripts/summarize-evals.mjs` to report aggregate score, total/average duration, total tokens, input/output/cache tokens, total cost, tool-call count, and per-case table rows.
- [ ] Make summary generation fail on an empty score directory unless explicitly allowed.
- [ ] Change `.github/workflows/evals.yml` to run `pnpm evals` instead of `pnpm eval`.
- [ ] Remove score strictness as an execution gate; fail CI only when the runner crashes, required setup is missing, result records are malformed, or zero completed records are produced.
- [ ] Upload summaries and redacted artifacts from the run output directory, but never upload `evals/profiles/`.
- [ ] Document the eval CLI in `evals/README.md`: run all evals, focus with `.only`, file filters, or `-t`, check profiles, create profiles, and add private eval files.
- [ ] Update `packages/libretto/docs/releasing.md` so it matches the real eval workflow; do not claim baseline comparison until it is actually wired.
- [ ] Success criteria: CI summary includes score, duration, token, cost, and tool-call metrics without exposing profile data.
- [ ] Success criteria: docs explain that `evals/profiles/` and `evals/private/` are always gitignored local maintainer directories.
