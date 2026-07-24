# Provider-selected browser pages

## Problem overview

`BrowserProvider.createSession()` returns a CDP endpoint, so `SessionRegistry` connects to the whole endpoint and chooses a context and page. A Craft Agent provider already knows which Electron `BrowserView` belongs to the session, but the registry can select another target and can close the host connection itself.

## Solution overview

Make every provider return its selected Playwright `Page` from `createSession()`. Providers retain `createSession()` and `closeSession()` and own browser connection and cleanup details. `SessionRegistry` registers the returned page without calling `connectOverCDP()` and calls `provider.closeSession()` when the logical session closes.

Keep `browser_connect` unchanged as the explicit raw-CDP tool. It remains registry-owned and may use the current context and page selection behavior.

## Goals

- A Craft Agent provider returns the exact Playwright page for its Electron `BrowserView`.
- `SessionRegistry` never derives a provider-created page from a CDP endpoint.
- `browser_close` and toolkit disposal call `provider.closeSession(sessionId)` once for provider-created sessions.
- A provider can release one Electron window without the registry closing the host browser.
- Built-in local and cloud providers keep their current launch options, metadata, and cleanup behavior.
- Pages opened after registration continue to appear in `browser_status`.

## Non-goals

- No changes to `browser_connect`, including target-ID selection or close behavior.
- No changes to `createBrowserToolsForPage()`.
- No shared-context isolation for `browser_exec`.
- No filtering of future `context.on("page")` events from a shared Electron context.
- No changes to the separate Libretto CLI provider API.
- No backward compatibility for custom browser-tools providers that return only a CDP endpoint.
- No migrations or backfills.

## Important files/docs/websites for implementation

- `packages/browser-tools/src/provider.ts` — Browser provider and provider-session contracts.
- `packages/browser-tools/src/session-registry.ts` — Provider session registration and cleanup.
- `packages/browser-tools/src/session-registry.spec.ts` — Selected-page and lifecycle coverage.
- `packages/browser-tools/src/tools/tools.spec.ts` — End-to-end `browser_open` and `browser_close` behavior.
- `packages/browser-tools/src/providers/local.ts` — Local Chromium launch, Playwright attachment, and cleanup.
- `packages/browser-tools/src/providers/browserbase.ts` — Browserbase connection and release.
- `packages/browser-tools/src/providers/browser-use.ts` — Browser Use connection and release.
- `packages/browser-tools/src/providers/kernel.ts` — Kernel connection, recording metadata, and release.
- `packages/browser-tools/src/providers/libretto-cloud.ts` — Libretto Cloud connection, recording metadata, and release.
- `packages/browser-tools/src/providers/steel.ts` — Steel connection and release.
- `packages/browser-tools/src/providers/*.spec.ts` — Built-in provider integration tests.
- `packages/browser-tools/benchmarks/harness/cloud-browser.ts` — Benchmark-only access to provider CDP endpoints.
- `docs/browser-tools/providers/custom.mdx` — Custom provider example.
- `docs/browser-tools/providers/overview.mdx` — Provider ownership documentation.
- [Playwright `BrowserType.connectOverCDP`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) — How built-in providers obtain Playwright pages.
- [Playwright `Browser.close`](https://playwright.dev/docs/api/class-browser#browser-close) — Cleanup behavior providers must own.

## Implementation

### Phase 1: Switch providers and the registry to pages

Change the contract atomically so `ProviderSession` has one representation. Built-in providers connect to CDP internally, while the registry accepts only the page they select.

```ts
// packages/browser-tools/src/provider.ts
export type ProviderSession = {
  sessionId: string;
  page: Page;
  liveViewUrl?: string;
  recordingUrl?: string;
  startUrlPreloaded?: boolean;
};

// packages/browser-tools/src/session-registry.ts
async openSession(options: ProviderSessionCreateOptions = {}) {
  const session = await this.provider.createSession(options);
  return this.registerProviderPage(session);
}
```

- [x] Replace `ProviderSession.cdpEndpoint` with required `ProviderSession.page`.
- [x] Add one small internal CDP helper that connects and returns `{ browser, page }`; close a partial connection if page selection fails.
- [x] Update all six built-in providers to connect internally and return `page`.
- [x] Keep each provider's Playwright browser handle by `sessionId` so `closeSession()` owns Playwright and remote cleanup.
- [x] Remove provider state before awaiting close so repeated `closeSession()` calls cannot clean up twice.
- [x] If CDP attachment fails after remote allocation, release the remote session before rejecting `createSession()`.
- [x] Preserve all existing provider options, live-view data, recording data, preload state, and close results.
- [x] Register only the supplied page initially.
- [x] Derive the context and browser from `page.context()` without calling `connectOverCDP()`.
- [x] Keep `context.on("page")` tracking for pages opened after registration.
- [x] On close or registration failure, remove registry listeners and call `provider.closeSession(sessionId)` without calling `browser.close()`.
- [x] Keep `browser_connect` and `createBrowserToolsForPage()` unchanged.
- [x] Add a test with two pages proving the registry selects the page returned by the provider.
- [x] Add a test proving close calls provider cleanup once while leaving the returned page and host browser open.
- [x] Add a blocked-page test proving partial registration calls provider cleanup once.
- [x] Update built-in provider tests to execute against `session.page` and close through `provider.closeSession(session.sessionId)`.
- [x] Add a local test proving two `closeSession()` calls close the browser once.
- [x] Retain provider CDP endpoints through an internal benchmark accessor and update the benchmark harness.
- [x] Verify `pnpm --filter libretto-browser-tools type-check` passes.
- [x] Verify `pnpm --filter libretto-browser-tools test` passes.

### Phase 2: Update benchmarks and provider documentation

Document the one canonical provider-session representation.

- [ ] Update custom-provider docs to return an exact page from `createSession()`.
- [ ] Document that providers own launch, CDP attachment, page selection, and cleanup.
- [ ] Confirm `browser_connect` documentation and behavior remain unchanged.
- [ ] Verify `pnpm --filter libretto-browser-tools type-check` passes.
- [ ] Verify `pnpm --filter libretto-browser-tools test` passes.
- [ ] Verify `pnpm -s lint` passes.
