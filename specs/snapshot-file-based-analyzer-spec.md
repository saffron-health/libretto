## Problem overview

The current snapshot analyzer no longer exposes the screenshot, full DOM, and condensed DOM as separate files for the configured analyzer to inspect on its own. Instead, `packages/libretto/src/cli/core/snapshot-analyzer.ts` reads the HTML files itself, chooses one DOM artifact in-process, embeds that HTML inline in the prompt, and sends the screenshot directly as an image attachment or base64 payload.

That makes snapshot analysis more deterministic, but it removes the older workflow where the analyzer could decide which snapshot artifact to open after seeing the screenshot and file paths. The old flow is valuable for experiments where we want to compare whether a tool-using model does better when it can read files selectively instead of receiving one preselected DOM artifact inline.

## Solution overview

Restore the file-based snapshot analyzer flow in `snapshot-analyzer.ts`. The CLI should still capture `page.png`, `page.html`, and `page.condensed.html`, but `runInterpret()` should stop embedding DOM contents inline. Instead it should build a prompt that lists the three file paths, includes size hints and a recommended HTML source, and instructs the analyzer to inspect the screenshot file first and then choose the appropriate HTML file to read.

This rollback should restore the old analyzer contract for Codex, Claude, and Gemini command-prefix analyzers while keeping the existing JSON output schema and snapshot capture behavior intact. Tests should stop asserting inline DOM/image transport and instead assert that the analyzer receives file-path-oriented instructions and can choose its own inputs.

## Goals

- Restore a file-based snapshot analysis prompt that exposes screenshot, full DOM, and condensed DOM as paths on disk.
- Let the configured analyzer decide which snapshot files to read instead of embedding the selected DOM inline in the prompt.
- Preserve the current `InterpretResult` JSON schema and CLI output format.
- Keep snapshot capture behavior unchanged: the CLI still writes `page.png`, `page.html`, and `page.condensed.html` to the session snapshot directory.
- Keep analyzer configuration under the existing `.libretto/config.json` AI config contract.

## Non-goals

- No migrations or backfills.
- No change to snapshot file naming or storage layout.
- No new analyzer presets, tool adapters, or prompt schema changes beyond what is required to restore the file-based workflow.
- No attempt to keep both inline and file-based analyzer modes in the same implementation.
- No change to DOM condensation behavior in `packages/libretto/src/cli/core/condense-dom.ts`.

## Future work

- Add an explicit analyzer mode switch so inline and file-based snapshot strategies can be compared without code rollback.
- Add a benchmark harness that scores selector quality across analyzer modes against live DOM ground truth.
- Add analyzer trace assertions that verify which files were actually opened during snapshot analysis.

## Important files/docs/websites for implementation

- `packages/libretto/src/cli/core/snapshot-analyzer.ts` - current inline snapshot selection and analyzer invocation logic; primary rollback target.
- `packages/libretto/src/cli/commands/snapshot.ts` - snapshot capture entrypoint; confirms the PNG, full HTML, and condensed HTML files are still written before interpretation.
- `packages/libretto/src/cli/core/ai-config.ts` - shared AI config contract; the rollback should continue to use this configuration path and preset handling.
- `packages/libretto/test/stateful.spec.ts` - contains the recorder-style tests that currently lock in inline DOM/image transport.
- `packages/libretto/test/condense-dom.spec.ts` - validates condensed DOM generation; should remain unchanged but serves as a guardrail that the condensed artifact still exists and is usable.
- `AGENTS.md` - repo-level command guidance for build, type-check, and test workflows.
- Local analyzer CLIs (`codex`, `claude`, `gemini`) - the rollback relies on their existing ability to read files from the workspace when given paths and appropriate file-reading tools.

## Implementation

### Phase 1: Restore file-based prompt construction in `snapshot-analyzer.ts`

- [ ] Reintroduce a prompt builder equivalent to the old `buildFileAnalyzerPrompt(...)` that takes `pngPath`, `htmlPath`, `condensedHtmlPath`, and snapshot size stats.
- [ ] Reintroduce a stats type equivalent to the old `SnapshotPromptStats` that includes screenshot byte size, full DOM estimated tokens, condensed DOM estimated tokens, configured model, estimated context window, safe read budget, and recommended HTML source.
- [ ] Build the prompt so it lists all three file paths explicitly and instructs the analyzer to inspect the screenshot file first, then choose between full and condensed DOM.
- [ ] Keep the current `buildInterpretInstructions()` JSON contract, but change the `debug.consultedFiles` wording back to file-path-based guidance rather than inline artifact names.
- [ ] Success criteria: the prompt text contains a `# Snapshot Files` section with `page.png`, `page.html`, and `page.condensed.html` paths and no embedded HTML body content.

### Phase 2: Remove inline DOM selection from `runInterpret()`

- [ ] Remove `InlinePromptSelection`, `buildSnapshotBudget(...)`, `buildSnapshotDomStats(...)`, `buildInlineHtmlPrompt(...)`, `buildInlinePromptSelection(...)`, and the `FULL_DOM_CONTEXT_WINDOW_RATIO` selection path.
- [ ] Restore the old behavior where `runInterpret()` computes prompt stats from file sizes and token estimates, then passes a file-based prompt to the configured analyzer.
- [ ] Restore the old guardrail that fails fast when condensed DOM still exceeds the safe read budget for analyzers with a known context window.
- [ ] Keep `runInterpret()` responsible only for validating file existence, computing stats, constructing the file-based prompt, invoking the analyzer, and formatting the parsed JSON output.
- [ ] Success criteria: `runInterpret()` no longer reads full or condensed HTML contents just to embed them into the prompt.

### Phase 3: Revert analyzer transports to the file-based contract

- [ ] Update `CodexUserCodingAgent.analyzeSnapshot(...)` so it no longer passes `--image` and instead sends the file-based prompt over stdin, relying on Codex file-reading tools to inspect the PNG and HTML files from disk.
- [ ] Update `ClaudeUserCodingAgent.analyzeSnapshot(...)` so it no longer builds stream-JSON image input and instead passes the file-based prompt text, relying on Claude file-reading tools to inspect the referenced files.
- [ ] Remove `buildClaudeStreamJsonInput(...)` and any remaining base64 image transport specific to configured command-prefix analyzers.
- [ ] Keep Gemini command-prefix behavior aligned with the same file-based prompt contract so all external analyzers see the same snapshot workflow.
- [ ] Preserve the existing library fallback path behind `getLLMClientFactory()` unless implementation review decides it should remain inline-only; if it stays, document it as a separate non-goal-compatible fallback.
- [ ] Success criteria: configured command-prefix analyzers receive a text prompt with snapshot file paths and no direct image payload or inline HTML payload.

### Phase 4: Restore and adjust snapshot analyzer tests

- [ ] Replace the recorder assertions in `packages/libretto/test/stateful.spec.ts` that currently require inline full DOM/image transport.
- [ ] Add or restore assertions that the analyzer prompt contains `The following snapshot files are available for your analysis. Use your file reading tools to access them.` and references the PNG, full DOM, and condensed DOM file paths.
- [ ] Remove assertions that require `Selected HTML snapshot: full DOM`, `Selected HTML snapshot: condensed DOM`, inline HTML content blocks, or structured/base64 image input for Claude.
- [ ] Preserve the high-level smoke tests that snapshot analysis runs successfully for each preset and that `--objective` remains the trigger for analysis.
- [ ] Success criteria: the only snapshot tests that change are the recorder-style transport assertions in `stateful.spec.ts`; smoke tests and unrelated command-behavior tests continue to pass unchanged.

### Phase 5: Verification and rollback guardrails

- [ ] Run `pnpm --filter libretto type-check`.
- [ ] Run `pnpm --filter libretto test -- test/stateful.spec.ts`.
- [ ] Run `pnpm --filter libretto test -- test/condense-dom.spec.ts` to ensure the condensed artifact logic still holds after the analyzer rollback.
- [ ] Manually verify one live `pnpm cli snapshot --objective ...` run against a headed session to confirm the analyzer can still open the saved screenshot and whichever HTML file it chooses.
- [ ] Success criteria: type-check passes, snapshot stateful tests pass with file-based prompt assertions, and a manual snapshot run returns parsed selector JSON without inline DOM transport.
