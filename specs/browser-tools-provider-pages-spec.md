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

### Phase 1: Add provider-selected page registration

Add the page path first so Craft can use it without changing built-in providers in the same commit. The temporary endpoint branch keeps the tree working while providers migrate; the final phase removes it.

```ts
// packages/browser-tools/src/provider.ts
export type ProviderSession =
  | { sessionId: string; page: Page; cdpEndpoint?: never; /* metadata */ }
  | { sessionId: string; cdpEndpoint: string; page?: never; /* metadata */ };

// packages/browser-tools/src/session-registry.ts
async openSession(options: ProviderSessionCreateOptions = {}) {
  const session = await this.provider.createSession(options);
  return session.page
    ? this.registerProviderPage(session)
    : this.registerProviderEndpoint(session);
}
```

- [ ] Add a typed provider-session variant containing `sessionId`, `page`, and existing metadata.
- [ ] Register only the supplied page initially for the page variant.
- [ ] Derive the context and browser from `page.context()` without calling `connectOverCDP()`.
- [ ] Keep `context.on("page")` tracking for pages opened after registration.
- [ ] On close or registration failure, remove registry listeners and call `provider.closeSession(sessionId)` without calling `browser.close()` for the page variant.
- [ ] Keep the current endpoint path unchanged during provider migration.
- [ ] Add a test with two pages proving the registry selects the page returned by the provider.
- [ ] Add a test proving close calls provider cleanup once while leaving the returned page and host browser open.
- [ ] Add a blocked-page test proving partial registration calls provider cleanup once.
- [ ] Verify `pnpm --filter libretto-browser-tools type-check` passes.
- [ ] Verify `pnpm --filter libretto-browser-tools test -- src/session-registry.spec.ts src/tools/tools.spec.ts` passes.

### Phase 2: Migrate local, Browserbase, and Browser Use providers

Move CDP attachment into the first provider group. Each provider stores its Playwright browser handle by provider session ID so `closeSession()` can detach Playwright and then perform existing browser or API cleanup.

```ts
// packages/browser-tools/src/providers/browserbase.ts
class BrowserbaseBrowserProvider implements BrowserProvider {
  private readonly browsers = new Map<string, Browser>();
  ...

  async createSession(options = {}) {
    const remote = await this.createRemoteSession(options);
    const { browser, page } = await connectProviderPage(remote.connectUrl);
    this.browsers.set(remote.id, browser);
    return { sessionId: remote.id, page, startUrlPreloaded: false };
  }
}
```

- [ ] Add one small internal CDP helper that connects and returns `{ browser, page }`; it must close a partial connection if page selection fails.
- [ ] Update `LocalBrowserProvider`, `BrowserbaseBrowserProvider`, and `BrowserUseBrowserProvider` to return `page`.
- [ ] Store each Playwright browser by `sessionId` and remove it from the map before awaiting close.
- [ ] Make `closeSession()` detach or close Playwright before running existing provider cleanup.
- [ ] If internal CDP attachment fails after remote allocation, release the remote session before rejecting `createSession()`.
- [ ] Preserve local channel and headless options, Browserbase settings, and Browser Use proxy and timeout options.
- [ ] Update provider tests to execute against `session.page` and close through `provider.closeSession(session.sessionId)`.
- [ ] Add a local test proving two `closeSession()` calls close the browser once.
- [ ] Verify `pnpm --filter libretto-browser-tools type-check` passes.
- [ ] Verify the three provider test files pass.

### Phase 3: Migrate Kernel, Steel, and Libretto Cloud providers

Apply the same provider-owned attachment and cleanup path to the remaining providers. Preserve preload and recording behavior rather than changing their API requests.

```ts
// packages/browser-tools/src/providers/kernel.ts
async createSession(options = {}) {
  const remote = await this.createKernelBrowser(options);
  const { browser, page } = await connectProviderPage(remote.cdp_ws_url);
  this.browsers.set(remote.session_id, browser);
  return {
    sessionId: remote.session_id,
    page,
    liveViewUrl: remote.browser_live_view_url ?? undefined,
    startUrlPreloaded: Boolean(options.startUrl),
  };
}
```

- [ ] Update Kernel, Steel, and Libretto Cloud providers to return their selected page.
- [ ] Keep provider browser handles keyed by `sessionId` and make close idempotent.
- [ ] Preserve Kernel CDP readiness retries, replay URLs, start URL, GPU, viewport, stealth, and proxy options.
- [ ] Preserve Steel viewer URL, dimensions, proxy, captcha, and timeout options.
- [ ] Preserve Libretto Cloud queue polling, live-view URL, recording lookup, start URL, GPU, viewport, headless, and timeout options.
- [ ] Release each remote session if internal Playwright attachment fails.
- [ ] Update the three provider integration tests to use the returned page and `closeSession()`.
- [ ] Verify `pnpm --filter libretto-browser-tools type-check` passes.
- [ ] Verify the three provider test files pass.

### Phase 4: Remove endpoint sessions from the provider contract

Finish the contract after every built-in provider returns a page. Keep endpoint data private for benchmarks and update the two provider docs.

```ts
// packages/browser-tools/src/provider.ts
export type ProviderSession = {
  sessionId: string;
  page: Page;
  liveViewUrl?: string;
  recordingUrl?: string;
  startUrlPreloaded?: boolean;
};
```

- [ ] Remove `cdpEndpoint` from the public `ProviderSession` contract and delete the temporary registry endpoint branch.
- [ ] Retain provider CDP endpoints only through an internal benchmark accessor.
- [ ] Update the benchmark harness to close through `provider.closeSession()`.
- [ ] Update custom-provider docs to return an exact page from `createSession()`.
- [ ] Document that providers own launch, CDP attachment, page selection, and cleanup.
- [ ] Confirm `browser_connect` documentation and behavior remain unchanged.
- [ ] Verify `pnpm --filter libretto-browser-tools type-check` passes.
- [ ] Verify `pnpm --filter libretto-browser-tools test` passes.
- [ ] Verify `pnpm -s lint` passes.
