## Problem overview

The Playwright debugging agent captures a failed `Page` but investigates with a new local browser. This loses the caller's authentication and in-memory state. Debugger infrastructure errors can also replace the caller's original automation failure, and generated Git branch names collide when two failures occur in the same repository during one second.

## Solution overview

Add a borrowed-page browser-tools adapter that operates directly on the supplied `Page` without owning its lifecycle. Use it in the debugging agent, return structured debugger failures instead of throwing, and add random entropy to generated branch names.

## Goals

- The debugging agent inspects the exact `Page` passed to `debugPlaywrightFailure()`, including its cookies, storage, active DOM, routes, and browser context.
- Disposing debugger tools never closes the caller's page, context, or browser.
- Debugger, model, broker, and GitHub failures return structured status without interrupting the caller's fallback or original error handling.
- Concurrent failures always receive distinct generated branch names.
- Two real Chromium tests verify state continuity and borrowed lifecycle without mocked pages or browser providers.

## Non-goals

- Do not change the public `createLibrettoDebugger()` setup shape.
- Do not add a configurable browser provider or branch-name option.
- Do not test live model quality or mutate a real GitHub repository in CI.
- No migrations or backfills.

## Important files/docs/websites for implementation

- `packages/browser-tools/src/session-registry.ts` — owns browser-tool sessions and cleanup behavior.
- `packages/browser-tools/src/create-browser-tools.ts` — creates framework-neutral browser tools.
- `packages/browser-tools/src/adapters/ai-sdk/index.ts` — exposes browser tools to the AI SDK.
- `packages/browser-tools/src/index.ts` — public browser-tools exports.
- `packages/browser-tools/src/adapters/ai-sdk/index.spec.ts` — real Chromium coverage for borrowed pages.
- `packages/playwright-debugger/src/index.ts` — debugging agent, structured results, branch creation, and error boundary.
- `packages/playwright-debugger/test/debugger.spec.ts` — debugger contract and GitHub request coverage.
- `docs/reference/runtime/playwright-debugger.mdx` — public failure-handling behavior.
- [Playwright Page](https://playwright.dev/docs/api/class-page) — a page retains its browser context and live state.
- [Playwright BrowserContext](https://playwright.dev/docs/api/class-browsercontext) — context ownership, pages, cookies, and storage behavior.

## Implementation

### Phase 1: Attach browser-tools to a borrowed Playwright page

Register an existing `Page` directly in `SessionRegistry` and expose only status, snapshot, and exec tools. Borrowed cleanup removes registry listeners and state without closing caller-owned Playwright objects.

```ts
// packages/browser-tools/src/create-browser-tools.ts
export function createBrowserToolsForPage(page: Page) {
  const registry = new SessionRegistry();
  const sessionId = registry.attachPage(page);
  return {
    sessionId,
    tools: createAttachedPageTools(registry),
    dispose: () => registry.dispose(),
  };
}
```

- [x] Add borrowed-page ownership semantics to `SessionRegistry`.
- [x] Track the supplied page as current while retaining popup/tab tracking from its context.
- [x] Remove borrowed-session listeners during disposal without closing the page, context, or browser.
- [x] Add framework-neutral and AI SDK factories that expose only `browser_exec`, `browser_snapshot`, and `browser_status`.
- [x] Export the borrowed-page factories from the browser-tools public entry points.
- [x] Add a real Chromium test proving tools read unsaved in-memory state from the exact supplied page, not another tab or browser.
- [x] Add a real Chromium test proving authenticated context state remains available and disposal leaves the caller's browser usable.

### Phase 2: Use the borrowed page in the debugging agent

Pass the supplied `Page` to the default agent runner and seed its attached session ID in the prompt. The agent must inspect that session instead of calling `browser_open`.

```ts
// packages/playwright-debugger/src/index.ts
async function runBrowserToolsDebugAgent(context, page, apiKey) {
  const browser = createAiSdkBrowserToolsForPage(page);
  await generateText({
    tools: { ...browser.tools, submit_fix: createSubmitFixTool() },
    messages: buildAgentMessages(context, browser.sessionId),
  });
  ...
}
```

- [x] Pass the failed `Page` into the default runner without adding it to the serializable public agent context.
- [x] Replace `browser_open` instructions with the pre-attached session ID and existing-page investigation instructions.
- [x] Ensure agent-tool disposal does not close or navigate away from the caller page by itself.
- [x] Update debugger tests and documentation to reflect same-session investigation.
- [x] Verify the browser-tools real Chromium tests exercise the same borrowed-page factory used by the debugger.

### Phase 3: Isolate debugger failures and generate unique branches

Wrap the full debugging workflow in a best-effort boundary and add a `debugger_failed` result. Append a random suffix to readable timestamp-based branch names so simultaneous failures cannot share a Git ref.

```ts
// packages/playwright-debugger/src/index.ts
async function debugPlaywrightFailure(error, page, options) {
  try {
    return await investigateAndOpenPullRequest(error, page, options);
  } catch (debuggerError) {
    return { status: "debugger_failed", error: errorMessage(debuggerError) };
  }
}
```

- [x] Add `debugger_failed` to `DebugPlaywrightFailureResult` with an actionable error message.
- [x] Catch capture, model, broker, GitHub, and cleanup failures inside `debugPlaywrightFailure()`.
- [x] Preserve constructor-time validation errors before a failed automation runs.
- [x] Add a random suffix to library-generated branch names.
- [x] Test two failures with the same owner, repository, and timestamp produce different branch names.
- [x] Test broker/GitHub failure returns `debugger_failed` and allows caller fallback plus original error rethrow.
- [x] Run frozen install, browser-tools tests, playwright-debugger tests, CLI tests, type checking, and linting.
