# Cloud Browser Providers

## Problem overview

Libretto currently only launches local Chromium instances via Playwright. Users who want to run automations against cloud browser infrastructure (Browserbase, Kernel) must manually create sessions via those APIs and pass a CDP URL to `libretto connect`. There's no first-class way to say `libretto open --provider kernel <url>`.

## Solution overview

Add a provider system to the `open` command that creates a cloud browser session via the provider's HTTP API, connects to the returned CDP WebSocket URL, and persists provider metadata in session state so `close` can tear down the remote session. Support Browserbase and Kernel as the initial two providers. Each provider implements a `ProviderApi` interface and lives in its own file under `providers/`.

## Goals

- `libretto open <url> --provider kernel` creates a Kernel cloud browser session and connects to it.
- `libretto open <url> --provider browserbase` creates a Browserbase cloud browser session and connects to it.
- Provider selection follows precedence: `--provider` flag > `LIBRETTO_PROVIDER` env var > `.libretto/config.json` `provider` field > local (default).
- `libretto close` cleans up the remote provider session (HTTP DELETE / status update).
- The provider system is easy to extend with new providers (add a file to `providers/`, implement `ProviderApi`).

## Non-goals

- No migrations or backfills.
- No provider support for the `run` command (only `open`).
- No provider-specific CLI flags (e.g. `--stealth`, `--kernel-profile`) — use env vars for provider-specific config.
- No interactive setup wizard for providers.

## Important files/docs/websites for implementation

- `packages/libretto/src/cli/core/browser.ts` — Core browser module with `runOpen`, `runClose`, `runConnect`, `connect`. The main file being modified.
- `packages/libretto/src/cli/commands/browser.ts` — CLI command definitions for `open`, `connect`, `close`. Where `--provider` flag is added.
- `packages/libretto/src/shared/state/session-state.ts` — Session state schema. Needs provider metadata fields.
- `packages/libretto/src/cli/core/session.ts` — Session state read/write/clear helpers.
- `packages/libretto/src/cli/core/config.ts` — Config file schema. Needs `provider` field.
- `packages/libretto/src/cli/core/context.ts` — Env var handling.
- `packages/libretto/test/browser.spec.ts` — Existing browser tests.
- Kernel API: `POST https://api.onkernel.com/browsers` (create), `DELETE https://api.onkernel.com/browsers/{session_id}` (close). Auth: `Authorization: Bearer <KERNEL_API_KEY>`. Response field: `cdp_ws_url`.
- Browserbase API: `POST https://api.browserbase.com/v1/sessions` (create), `POST https://api.browserbase.com/v1/sessions/{id}` with `{"status":"REQUEST_RELEASE"}` (close). Auth: `X-BB-API-Key: <BROWSERBASE_API_KEY>`. Response field: `connectUrl`.

## Implementation

### Phase 1: Add provider metadata to session state

Extend the session state schema so provider info survives across CLI invocations (needed for `close` to know which provider API to call).

```ts
// In session-state.ts
export const ProviderStateSchema = z.object({
  name: z.string(), // "kernel" | "browserbase"
  sessionId: z.string(), // remote session id for cleanup
});

export const SessionStateFileSchema = z.object({
  // ... existing fields ...
  provider: ProviderStateSchema.optional(),
});
```

- [x] Add `ProviderStateSchema` to `packages/libretto/src/shared/state/session-state.ts` with `name` (string) and `sessionId` (string) fields.
- [x] Add optional `provider` field to `SessionStateFileSchema`.
- [x] Verify `pnpm --filter libretto type-check` passes.

### Phase 2: Define ProviderApi type, provider modules, and resolution logic

Establish the provider interface contract and the three-tier resolution: CLI flag > env var > config file > default (local). Each provider lives in its own file under `providers/`.

```ts
// In packages/libretto/src/cli/core/providers/types.ts
export type ProviderSession = {
  sessionId: string;   // remote session id for cleanup
  cdpEndpoint: string; // CDP WebSocket URL
};

export type ProviderApi = {
  createSession(): Promise<ProviderSession>;
  closeSession(sessionId: string): Promise<void>;
};

// In packages/libretto/src/cli/core/providers/index.ts
export type ProviderName = "local" | "kernel" | "browserbase";

export function resolveProviderName(cliFlag?: string): ProviderName { ... }
export function getProvider(name: Exclude<ProviderName, "local">): ProviderApi { ... }
```

- [x] Create `packages/libretto/src/cli/core/providers/types.ts` with `ProviderSession` (without `name` — caller knows the provider) and `ProviderApi` types.
- [x] Create `packages/libretto/src/cli/core/providers/index.ts` with `resolveProviderName()` implementing the precedence chain and `getProvider()` that dispatches to provider modules.
- [x] Add optional `provider` field (string) to `LibrettoConfigSchema` in `packages/libretto/src/cli/core/config.ts`.
- [x] Add a unit test in `packages/libretto/test/browser.spec.ts` that verifies resolution precedence: flag wins over env var, env var wins over config, defaults to `"local"`.
- [x] Verify `pnpm --filter libretto type-check` passes.
- [x] Verify `pnpm --filter libretto test -- test/browser.spec.ts` passes.

### Phase 3: Implement Kernel and Browserbase provider modules

Each provider gets its own file under `providers/` implementing the `ProviderApi` interface. Each file reads its own env vars and makes HTTP API calls.

```ts
// In packages/libretto/src/cli/core/providers/kernel.ts
import type { ProviderApi } from "./types.js";

export function createKernelProvider(): ProviderApi {
  const apiKey = process.env.KERNEL_API_KEY;
  if (!apiKey)
    throw new Error("KERNEL_API_KEY is required for Kernel provider.");
  const endpoint = process.env.KERNEL_ENDPOINT ?? "https://api.onkernel.com";

  return {
    async createSession() {
      const resp = await fetch(`${endpoint}/browsers`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          headless: process.env.KERNEL_HEADLESS !== "false",
          stealth: process.env.KERNEL_STEALTH === "true",
          timeout_seconds: Number(process.env.KERNEL_TIMEOUT_SECONDS ?? 300),
        }),
      });
      const json = await resp.json();
      return {
        name: "kernel",
        sessionId: json.session_id,
        cdpEndpoint: json.cdp_ws_url,
      };
    },
    async closeSession(sessionId) {
      await fetch(`${endpoint}/browsers/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    },
  };
}
```

- [x] Create `packages/libretto/src/cli/core/providers/kernel.ts` exporting `createKernelProvider()` that returns a `ProviderApi`. Kernel API: `POST /browsers` returns `{ session_id, cdp_ws_url }`, `DELETE /browsers/{session_id}`.
- [x] Create `packages/libretto/src/cli/core/providers/browserbase.ts` exporting `createBrowserbaseProvider()` that returns a `ProviderApi`. Browserbase API: `POST /v1/sessions` with `{ projectId }` returns `{ id, connectUrl }`, close via `POST /v1/sessions/{id}` with `{ status: "REQUEST_RELEASE" }`.
- [x] Wire both into `getProvider()` in `providers/index.ts`.
- [x] Validate that missing API key env vars produce clear error messages (e.g. `KERNEL_API_KEY is required for Kernel provider.`).
- [x] Verify `pnpm --filter libretto type-check` passes.

### Phase 4: Wire `--provider` into the `open` command

Add the `--provider` flag to `open`, branch on provider name: local uses existing `runOpen` logic, cloud providers call `provider.createSession()` then `connectOverCDP`.

```ts
// In browser.ts openCommand handler
const providerName = resolveProviderName(input.provider);
if (providerName === "local") {
  await runOpen(input.url!, headed, ctx.session, ctx.logger, { viewport });
} else {
  const provider = getProvider(providerName);
  await runOpenWithProvider(input.url!, provider, ctx.session, ctx.logger);
}
```

- [x] Add `--provider` option (with `-p` shorthand) to `openInput` in `packages/libretto/src/cli/commands/browser.ts`.
- [x] Add `runOpenWithProvider()` to `packages/libretto/src/cli/core/browser.ts` that: (1) calls `provider.createSession()`, (2) connects via `chromium.connectOverCDP(cdpEndpoint)`, (3) navigates to the URL, (4) writes session state including the `provider` field.
- [x] Update the `open` command handler to branch on provider.
- [x] Manual test: `KERNEL_API_KEY=... libretto open https://example.com --provider kernel` opens a remote browser and `libretto pages` lists the page.
- [x] Verify `pnpm --filter libretto type-check` passes.

### Phase 5: Wire provider cleanup into the `close` command

When closing a session that has provider metadata, call `getProvider().closeSession()` to release the remote browser.

```ts
// In browser.ts runClose()
if (state.provider) {
  const provider = getProvider(state.provider.name);
  await provider.closeSession(state.provider.sessionId);
}
```

- [x] Update `runClose()` in `packages/libretto/src/cli/core/browser.ts` to call `getProvider(state.provider.name).closeSession(state.provider.sessionId)` when `state.provider` is present, before killing the local process.
- [x] Update `runCloseAll()` to also call provider cleanup for each session with provider metadata.
- [x] For provider sessions, skip the local pid-based kill logic (there is no local browser process to kill).
- [x] Fix `connect()` to attempt `provider.closeSession()` before clearing state when CDP connection fails for provider sessions (prevents remote session leaks).
- [x] Manual test: `libretto close --session <name>` on a Kernel session calls `DELETE /browsers/{id}` and clears state.
- [x] Verify `pnpm --filter libretto type-check` passes.
