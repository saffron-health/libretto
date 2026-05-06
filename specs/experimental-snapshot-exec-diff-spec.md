## Problem overview

The experimental worktree `.worktrees/tk-snapshot-exec-diff-pw-ai/` has the rough draft of a more agent-friendly snapshot tree and structural page-change diff after `exec`. This branch still uses `snapshot` for PNG+HTML capture plus API analysis, and `exec` returns only command output, so maintainers cannot try the new snapshot/diff loop here without replacing stable behavior.

## Solution overview

Add one internal experiment that switches `libretto snapshot` to a daemon-backed compact accessibility snapshot and enables structural page-change diffs after `libretto exec`. The implementation has one snapshot format and one rendering path: Playwright `Page` -> full `Snapshot` tree -> rendered string. The daemon owns snapshot capture and caching: unscoped `snapshot` captures a screenshot, refreshes and stores the latest full snapshot tree, scoped `snapshot <ref>` captures a fresh screenshot but reuses that cached tree and errors if no snapshot has been captured yet, and `exec` uses the cached snapshot as its before-state when available before replacing/invalidating it with the latest page state.

## Goals

- Users can enable an experiment and run `libretto snapshot --session <name>` to capture, cache, and print a compact accessibility snapshot from the session daemon.
- Users see the screenshot path before the compact accessibility tree, so they can inspect the visual page state alongside the tree.
- Users can run `libretto snapshot <ref> --session <name>` after a full snapshot has been captured to print only that cached subtree without recapturing the snapshot tree.
- Users get an actionable error when they request `snapshot <ref>` before a full compact snapshot exists in the daemon cache.
- Users who run `libretto exec` while the experiment is enabled see a structural page-change diff after successful mutating exec calls.
- A snapshot taken immediately before `exec` can be reused as the exec before-state, so diffs align with the snapshot the user just saw.
- Existing `libretto snapshot --objective ... --context ...` behavior remains unchanged while the experiment is disabled.
- The experiment stays internal to CLI and daemon machinery and is not exposed to workflow code.

## Non-goals

- No migrations or backfills.
- Do not remove the current PNG+HTML+AI snapshot analysis path.
- Do not redesign daemon lifecycle, daemon transport, page selection, or workflow execution.
- Do not add a public workflow API for experiments or snapshots.
- Do not add alternative snapshot render formats, renderer profiles, or a `projected`/`default` rendering switch.
- Do not add a new user-facing snapshot subcommand in v1; the experiment replaces `snapshot` behavior only while enabled.
- Do not persist snapshot cache to disk; daemon memory is enough for the experiment.

## Future work

None yet.

## Important files/docs/websites for implementation

- `packages/libretto/docs/experiments.md` — experiment registry, CLI, config, and daemon plumbing conventions.
- `docs/tests-guide.md` — testing rules for user-level CLI tests.
- `packages/libretto/package.json` — add test-only dev dependencies such as `outdent` when needed.
- `packages/libretto/src/cli/core/experiments.ts` — add the new internal experiment flag.
- `packages/libretto/src/cli/commands/experiments.ts` — listing/enable/disable output will include the new flag automatically through the registry.
- `packages/libretto/src/cli/commands/snapshot.ts` — switch snapshot command parsing and dispatch based on the experiment while preserving default AI analysis behavior.
- `packages/libretto/src/cli/core/daemon/snapshot.ts` — add compact screenshot capture, snapshot tree capture, and cached-snapshot lookup paths next to the existing PNG+HTML capture path.
- `packages/libretto/src/cli/core/daemon/exec.ts` — use cached before snapshots, capture after snapshots, diff, and return the diff with exec results.
- `packages/libretto/src/cli/core/daemon/ipc.ts` — extend daemon IPC types for compact snapshot requests, cached ref lookups, compact snapshot results with screenshot paths, and optional exec diff output.
- `packages/libretto/src/cli/core/daemon/daemon.ts` — own the in-memory latest snapshot cache and route snapshot/exec requests using the daemon’s startup experiment snapshot.
- `packages/libretto/src/shared/snapshot/` — new shared snapshot capture, render, stability wait, and diff implementation.
- `.worktrees/tk-snapshot-exec-diff-pw-ai/packages/libretto/src/shared/snapshot/` — rough reference implementation to adapt selectively, not port wholesale.
- `.worktrees/tk-snapshot-exec-diff-pw-ai/packages/libretto/src/cli/core/daemon/exec.ts` — rough exec diff integration to adapt to cached before snapshots.
- `.worktrees/tk-snapshot-exec-diff-pw-ai/packages/libretto/src/cli/commands/snapshot.ts` — rough text snapshot command behavior to adapt to daemon-returned snapshot trees.
- `packages/libretto/test/daemon-ipc.spec.ts` — best place for daemon-backed user-level snapshot cache and exec diff regression tests.
- `packages/libretto/test/stateful.spec.ts` — current missing `--objective` behavior should remain covered when the experiment is disabled.

## Implementation

### Phase 1: Register the compact snapshot experiment

Add the experiment flag first so later phases can be gated without exposing unstable behavior by default. Keep this phase limited to registry metadata and any user-visible experiment listing expectation updates.

```ts
export const EXPERIMENTS = {
  exampleExperiment: {
    /* existing */
  },
  compactSnapshotFormat: {
    title: "Compact snapshot format",
    oneSentenceDescription:
      "Use compact accessibility snapshots and exec page-change diffs without an AI sub-agent.",
    defaultValue: false,
  },
} as const;
```

- [x] Add `compactSnapshotFormat` to `packages/libretto/src/cli/core/experiments.ts` with `defaultValue: false`
- [x] Ensure `ExperimentName` and `Experiments` continue to infer from the registry without duplicated types
- [x] Verify `pnpm -s type-check --filter=libretto` passes
- [x] Add or update a user-level experiment CLI test only if existing coverage does not already assert registry listing behavior

### Phase 2: Add the shared snapshot tree API

Add the snapshot tree type and capture helper. Keep the core capture API simple and singular: `snapshot(page) -> Snapshot`, where `Snapshot` is always the full tree that later code can render, scope by ref, cache, or diff.

```ts
type Snapshot = {
  title: string;
  url: string;
  frames: SnapshotFrame[];
};

async function snapshot(page: Page): Promise<Snapshot> {
  return captureFullSnapshotTree(page);
}
```

- [x] Add `packages/libretto/src/shared/snapshot/types.ts`
- [x] Add `snapshot(page)`, `findSnapshotNodeByRef`, and `scopeSnapshotToRef` in `packages/libretto/src/shared/snapshot/capture-snapshot.ts`
- [x] Keep `Snapshot` as a tree type, not a pre-rendered string
- [x] Preserve the useful ref behavior from the worktree: `l<number>` assignment and numeric-suffix fallback for refs like `e16`
- [x] Reuse only the capture details from the worktree that are needed for the compact tree: accessibility role/name/value/state, useful DOM attributes, and enough metadata for clickable elements
- [x] Avoid adding renderer profile fields, alternate raw/default render models, or a `projected` argument
- [x] Treat `snapshot(page)` as daemon/internal machinery; compact snapshot CLI calls must go through daemon IPC
- [x] Verify `pnpm -s type-check --filter=libretto` passes
- [x] Add focused coverage through renderer/diff unit tests and later user-level CLI tests rather than testing CDP capture internals directly

### Phase 3: Add the single snapshot renderer and diff helper

Add one renderer for the `Snapshot` tree and one structural diff helper. Do not introduce alternate render formats; the snapshot tree is the source of truth, `renderSnapshot(snapshot, refId?)` is the only user-visible string conversion, and `diffSnapshots(before, after)` compares two full trees.

```ts
function renderSnapshot(snapshot: Snapshot, refId?: string): string {
  const tree = refId ? scopeSnapshotToRef(snapshot, refId) : snapshot;
  return renderSnapshotTree(tree);
}

function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  return diffSnapshotTrees(before, after);
}
```

- [x] Add `packages/libretto/src/shared/snapshot/render-snapshot.ts`
- [x] Add `packages/libretto/src/shared/snapshot/diff-snapshots.ts`
- [x] Match the intended compact snapshot format: page/frame tags, semantic role tags, heading text, and refs
- [x] Implement ref scoping in `renderSnapshot(snapshot, refId?)` by rendering a scoped view of the already-captured tree; do not recapture the page to satisfy a ref request
- [x] Keep only one rendering path; do not add `toRenderedSnapshot(snapshot, "projected")` or any equivalent profile switch
- [x] Keep renderer module exports limited to APIs and types needed by `render-snapshot.ts` and `diff-snapshots.ts`; do not export private formatting helpers
- [x] Include the minimal compaction needed for useful agent output: low-value wrapper flattening, clickable generic promotion, single-child chain folding, and child truncation summaries
- [x] Preserve the useful diff behavior from the worktree: structural tree comparison, `+`/`-`/`~` output or equivalent typed metadata, context ancestors, low-signal attr suppression, normalized href comparison, and diff truncation summaries
- [x] Add a small `renderSnapshotDiff(diff)` only if CLI output needs a separate formatting step; keep `diffSnapshots(before, after) -> SnapshotDiff` as the core API
- [x] Verify `pnpm -s type-check --filter=libretto` passes

### Phase 3.5: Replace renderer/diff tests with browser-backed HTML fixtures

Add focused renderer and diff tests that read like real pages. The tests should render HTML in Playwright, call the existing `snapshot(page)` capture helper, then assert `renderSnapshot(snapshot, refId?)` and `renderSnapshotDiff(diffSnapshots(before, after))`. This keeps fixtures easy to copy from real HTML while avoiding a second hand-maintained HTML or accessibility parser in tests.

Keep `renderSnapshot` itself pure: it should render only the snapshot tree. Command guidance such as the subtree hint belongs in the higher-level compact snapshot command output, not in the shared renderer.

- [x] Add `outdent` as a `packages/libretto` dev dependency for readable HTML and expected-output fixtures
- [x] Add or update a colocated test file, for example `packages/libretto/src/shared/snapshot/snapshot.spec.ts`
- [x] Add browser-backed helpers such as `expectSnapshot(html)` and `expectSnapshotDiff(beforeHtml, afterHtml)` that render HTML with Playwright, call `snapshot(page)`, then compare the rendered snapshot/diff output
- [x] Do not require helpers to load a fake URL just to set page metadata; use the simplest Playwright setup that lets copied HTML render reliably, and treat the page URL as incidental test output
- [x] Use `<title>` metadata from the fixture HTML for snapshot titles
- [x] Cover `renderSnapshot(snapshot)` output for page/frame tags, heading text, refs, and semantic role tags
- [x] Cover `renderSnapshot(snapshot, refId)` scoping from an already-captured tree, including numeric-suffix fallback such as `e16` matching `l16`
- [x] Cover renderer compaction behavior that is easy to regress: low-value wrapper flattening, clickable generic promotion, single-child chain folding, and child truncation summaries
- [x] Cover `diffSnapshots(before, after)` and `renderSnapshotDiff(diff)` for unchanged, added, removed, and modified nodes with context ancestors
- [x] Cover diff signal handling for ref-only changes and href query/hash changes so low-signal differences do not produce noisy diffs; use direct `Snapshot` fixtures only for edge cases that cannot be expressed through real rendered HTML
- [x] Remove the subtree hint from `renderSnapshot`; keep the hint requirement in the later compact snapshot CLI/daemon phase
- [x] Keep tests behavior-focused; do not assert private helper names or CDP capture details
- [x] Run `pnpm -s test --filter=libretto -- snapshot-render-diff.spec.ts`
- [x] Run `pnpm -s type-check --filter=libretto`

### Phase 4: Add page stability waiting

Add a small page stability wait helper for the daemon paths that capture compact snapshots. Use an Alumnium-style browser-side waiter: inject an idempotent script that tracks page load, DOM mutation idle, pending DOM resources, and pending `fetch`/`XMLHttpRequest` activity before resolving stability. Do not add a combined `stableSnapshot` abstraction; each caller should explicitly wait for page stability and then call `snapshot(page)` so the capture flow stays obvious.

```ts
async function captureCompactSnapshot(page: Page): Promise<Snapshot> {
  const waitResult = await waitForPageStable(page);
  if (!waitResult.ok) logSnapshotStabilityWarning(waitResult.diagnostics);
  return snapshot(page);
}
```

- [x] Add a page stability helper, for example `waitForPageStable(page)`, under `packages/libretto/src/shared/snapshot/`
- [x] Preserve the useful behavior from the worktree and Alumnium research: bounded wait, load-state checks, DOM mutation idle, minimum wait, pending resource checks, and browser-side `fetch`/`XMLHttpRequest` tracking
- [x] Treat stability failures as warnings for snapshot command and exec diff; do not fail the command only because stability timed out
- [x] Inline the caller flow in daemon code as `waitForPageStable(page)` followed by `snapshot(page)` before user-requested compact snapshots and before exec after-snapshots. Compact daemon snapshot and exec-diff paths are added in later phases; those callers will use this helper inline rather than a combined capture helper.
- [x] Do not add a `stableSnapshot`, `captureStableSnapshot`, or equivalent helper that combines waiting and capture
- [x] Verify `pnpm -s type-check --filter=libretto` passes

### Phase 5: Gate daemon-backed `libretto snapshot [ref]` behind the experiment

Make the snapshot command support both modes. With `compactSnapshotFormat` disabled, keep requiring `--objective` and `--context` and use the existing PNG+HTML+AI path; with it enabled, unscoped `snapshot` asks the daemon to capture a screenshot plus a full snapshot tree and cache the tree, while scoped `snapshot <ref>` asks the daemon to capture a fresh screenshot and return the latest cached tree without recapturing the tree. The CLI prints the screenshot path, then renders the returned tree with `renderSnapshot(snapshot, input.ref)` and prints it.

```ts
type CompactSnapshotResult = {
  mode: "compact";
  pngPath: string;
  snapshot: Snapshot;
};

async function runCompactSnapshot(input: SnapshotInput, ctx: SnapshotContext) {
  const client = await DaemonClient.connect(
    requireDaemonSocket(ctx.sessionState),
  );
  const result = await client.snapshot({
    mode: "compact",
    pageId: input.page,
    useCachedSnapshot: input.ref !== undefined,
  });
  console.log(`Screenshot at ${result.pngPath}`);
  console.log(renderSnapshot(result.snapshot, input.ref));
}
```

- [x] Add `withExperiments()` to `snapshotCommand`
- [x] Change `objective` and `context` input fields to optional at parse time, then require them in the disabled/default path with the existing error wording as closely as possible
- [x] Add optional positional `ref` and reject it with an actionable error when the experiment is disabled
- [x] Extend daemon snapshot IPC args/results to support compact snapshot requests and a cached-snapshot request flag for `snapshot <ref>`
- [x] In `packages/libretto/src/cli/core/daemon/snapshot.ts`, keep the existing PNG+HTML return shape for default mode and add a compact return shape containing a screenshot `pngPath` and full `Snapshot` tree
- [x] For every compact `snapshot` command, capture a screenshot before returning and print it in CLI output before the tree as `Screenshot at <path>`
- [x] After compact snapshot output, print the subtree guidance hint at the CLI/daemon output layer rather than from `renderSnapshot`; use `librettoCommand(...)` for the command text
- [x] Reuse the existing screenshot viewport normalization and zero-width retry behavior where practical; do not create a separate screenshot abstraction unless duplication becomes unavoidable
- [x] In `packages/libretto/src/cli/core/daemon/daemon.ts`, store the latest full compact snapshot in daemon memory after each unscoped compact `snapshot` command
- [x] If a ref is requested, do not capture a new snapshot tree; capture only the screenshot, return the latest cached full snapshot, then let `renderSnapshot(snapshot, refId)` scope it
- [x] If a ref is requested and no compact snapshot is cached, throw an actionable error telling the user to run `libretto snapshot --session <name>` first
- [x] Keep compact snapshot capture inside the daemon; the CLI must not use `connect()` or open a second browser/CDP connection
- [x] Verify disabled behavior with an existing or updated test: `snapshot --session <name>` still reports missing `--objective`
- [x] Add a user-level daemon-backed test that enables the experiment, opens a fixture page, runs `snapshot --session <name>`, and sees `Screenshot at ` before compact output such as `<page`, `# Heading`, and the subtree hint
- [x] Add a user-level daemon-backed test that runs `snapshot <ref> --session <name>` after a previous full snapshot and sees only the expected subtree text
- [x] Add a user-level daemon-backed test that `snapshot <ref> --session <name>` fails before any compact snapshot has been cached
- [x] Add experiment description docs discoverable with `libretto experiments describe compactSnapshotFormat`
- [x] Run `pnpm -s test --filter=libretto -- daemon-ipc.spec.ts stateful.spec.ts` or the closest existing targeted test command supported by the repo

### Phase 6: Use the daemon snapshot cache for exec diffs

Implement exec diffs around the daemon-owned latest snapshot cache. Exec should use the cached snapshot as its before-state when available, capture a fresh before-state only when no cache exists, run user code, wait for stability, capture the after-state, diff the two trees, return the diff with the exec result, and replace the cache with the after-state.

```ts
async function handleCompactExec(args: ExecArgs, cache: SnapshotCache) {
  const before = cache.latest ?? (await snapshot(args.page));
  const result = await runUserExec(args);
  await waitForPageStable(args.page);
  const after = await snapshot(args.page);
  cache.latest = after;
  return { ...result, snapshotDiff: diffSnapshots(before, after) };
}
```

- [x] Add daemon-owned snapshot cache state in `packages/libretto/src/cli/core/daemon/daemon.ts`, for example `latestCompactSnapshot: Snapshot | null`
- [x] Pass the cached before snapshot into the exec handler or keep the cache orchestration in daemon before/after calling `handleExec`
- [x] If no cached snapshot exists, capture a fresh before snapshot immediately before running user exec code
- [x] Always diff full snapshots; scoped `snapshot <ref>` must not replace the cache with a subtree
- [x] Run user exec code exactly once and preserve existing result/output/error behavior
- [x] After successful exec, wait for page stability, capture the after snapshot, and compute `diffSnapshots(before, after)`
- [x] Return the diff with the exec result and print user-visible page changes after normal exec output
- [x] Replace the daemon cache with the after snapshot after successful exec
- [x] Invalidate the daemon cache on exec failure unless an after snapshot is deliberately captured and stored; keep v1 simple by clearing it on failure
- [x] Ensure `readonly-exec` never captures, invalidates, or prints page-change diffs
- [x] Add a user-level daemon-backed test where `snapshot` is run first, then `exec` mutates the page, and the exec diff reflects the change from the previously returned snapshot
- [x] Add a user-level daemon-backed test where `exec` is run without a previous snapshot and still prints a diff by capturing its own before-state
- [x] Add a user-level daemon-backed test that `readonly-exec` does not print page changes and does not invalidate the snapshot cache
- [x] Run `pnpm -s test --filter=libretto -- daemon-ipc.spec.ts`

### Phase 7: Keep package exports minimal

Expose snapshot helpers from the package root only if tests or internal experiment consumers require direct imports. Do not introduce a barrel file inside `shared/snapshot`, and do not expose experiment state on public workflow APIs.

```ts
export {
  snapshot,
  renderSnapshot,
  diffSnapshots,
  type Snapshot,
  type SnapshotDiff,
} from "./shared/snapshot/capture-snapshot.js";
```

- [ ] Export snapshot helpers from `packages/libretto/src/index.ts` only if external package consumers or tests need them
- [ ] Skip this phase if all usage stays inside CLI/daemon internals
- [ ] Verify `pnpm -s type-check --filter=libretto` passes

### Phase 8: Update skill/docs guidance for the experiment

Document how maintainers enable and try the experiment without changing the public docs for the stable snapshot analysis path. Keep mirrored skill files in sync through the source skill file and mirror command.

- [ ] Update `packages/libretto/skills/libretto/SKILL.md` with the experimental `snapshot [ref]` and `exec` diff behavior only if skill guidance should mention experiments
- [ ] Do not hand-edit `.agents/skills/` or `.claude/skills/`; run `pnpm sync:mirrors` after editing the source skill file
- [ ] Avoid changing Mintlify user docs unless the experiment is intended to be user-facing
- [ ] Run `pnpm check:mirrors` if mirrored skill files change
- [ ] Run `pnpm -s type-check --filter=libretto`
