# Browser Tools Auth Profiles

## Problem overview

`libretto-browser-tools` starts each browser session with fresh state. A user can sign in through a headed browser or cloud live view, but closing that session discards the login, so the next agent session must sign in again.

## Solution overview

Add an `authProfile` string or `false` to `browser_open` and pass named profiles through the provider contract. `browser_open` uses `default` when callers omit the field and the configured provider supports named profiles; `false` starts an unprofiled session. Local sessions use a persistent Chromium user data directory. Supported cloud providers use their native named profiles and save changes when `browser_close` releases the session.

The string is a profile name for Local, Libretto Cloud, Kernel, and Browser Use. Browserbase contexts and Steel profiles expose only opaque provider IDs, so they remain unsupported until Libretto has a durable name-to-ID mapping.

## Goals

- An agent can open a browser with `browser_open({ authProfile: "work" })`.
- An agent that omits `authProfile` gets the named `default` profile when the provider supports named profiles.
- An agent can pass `authProfile: false` to start an unprofiled session.
- A human can sign in through the browser window or cloud live view, close the session, and find the login restored on the next open with the same profile.
- Local profiles preserve the full Chromium user data directory, including cookies, local storage, IndexedDB, saved credentials, extensions, and browser settings.
- Every bundled provider that has native named profile support uses it: Libretto Cloud, Kernel, and Browser Use, plus the local provider.
- Providers without auth profile support return an actionable tool error when a caller supplies `authProfile` instead of silently starting a fresh session.
- `browser_open` tells the agent when the configured provider does not support named profiles.
- `browser_status` reports the resolved profile name for each provider-owned session.
- Invalid or ambiguous profile names return actionable `{ ok: false, error }` tool results.
- Profile changes persist only after an explicit `browser_close` or graceful toolkit disposal.
- Expected auth-profile failures flow as `AuthProfileError` values through providers and the session registry; host failures still reject.
- Provider and browser cleanup failures return typed error values, including every cause when more than one cleanup step fails.

## Non-goals

- No migrations or backfills.
- No profile list, rename, delete, import, export, or login tools.
- No common remote profile registry or local alias-to-ID mapping for providers that expose only opaque IDs.
- No caller-facing ephemeral opt-out from `default` when `browser_open` uses a provider with named profile support.
- No read-only profile mode; sessions opened with a profile write changes back on close.
- No guarantee that profile changes survive `SIGKILL`, OOM, provider failure, or other hard crashes.
- No support for concurrent writable sessions using the same profile.
- No auth profile behavior for `browser_connect` or caller-owned pages.
- No repo-wide conversion to errors as values; this work adopts Errore only for auth profile errors.

## Important files/docs/websites for implementation

- `packages/browser-tools/src/tools/open.ts` — defines the `browser_open` schema, description, and execution path.
- `packages/browser-tools/src/provider.ts` — defines the provider session creation contract and profile capability.
- `packages/browser-tools/src/session-registry.ts` — owns session lifecycle, rejects unsupported providers, and must release provider sessions before disconnecting CDP.
- `packages/browser-tools/src/providers/local.ts` — launches local Chromium and will own persistent user data directories.
- `packages/browser-tools/src/providers/libretto-cloud.ts` — maps profile names to Libretto Cloud session creation.
- `packages/browser-tools/src/providers/kernel.ts` — creates or reuses a named Kernel profile with `save_changes: true`.
- `packages/browser-tools/src/providers/browser-use.ts` — resolves or creates a named Browser Use profile and passes its ID to the browser session.
- `packages/browser-tools/src/providers/browserbase.ts` — remains unsupported because Browserbase contexts have generated IDs but no names.
- `packages/browser-tools/src/providers/steel.ts` — remains unsupported because Steel profiles have generated IDs but no names.
- `packages/browser-tools/src/tools/tools.spec.ts` — tests user-level `browser_open` → browser work → `browser_close` flows.
- `packages/browser-tools/src/session-registry.spec.ts` — tests provider cleanup order and unsupported-provider behavior.
- `packages/browser-tools/src/providers/*.spec.ts` — tests local behavior and credential-gated live provider flows without stubbing cloud APIs.
- `packages/browser-tools/package.json` — adds the `errore` runtime dependency.
- `.agents/skills/errore/SKILL.md` — upstream Errore skill installed at repository scope.
- `skills-lock.json` — tracks the upstream skill source and content hash.
- `AGENTS.md` — scopes incremental Errore adoption and tells agents when to read its skill.
- `packages/browser-tools/README.md` — documents profile use, provider-specific references, persistence timing, and security.
- [Errore](https://errore.org/) — tagged errors and internal error-as-value unions.
- [Playwright persistent authentication](https://playwright.dev/docs/auth) — background on persisted browser state.
- [Kernel Profiles](https://www.kernel.sh/docs/auth/profiles) — named profiles and `save_changes`.
- [Browser Use Profiles](https://docs.browser-use.com/cloud/guides/authentication) — profile lookup/create and save-on-stop behavior.
- [Browserbase Contexts](https://docs.browserbase.com/platform/browser/core-features/contexts) — context IDs and `persist: true`.
- [Steel Profiles](https://docs.steel.dev/cookbook/profiles) — profile IDs and `persistProfile: true`.

## Implementation

### Phase 0: Install Errore and its agent guidance

Add the package and skill before changing error behavior. Scope the new convention to expected failures in `packages/browser-tools` so the rest of the repository can adopt it separately.

- [x] Add `errore` 0.14.1 as a runtime dependency of `libretto-browser-tools`.
- [x] Install the upstream `remorses/errore` skill at repository scope and track it in `skills-lock.json`; do not add it to Libretto's exported skill mirrors.
- [x] Update `AGENTS.md`: do not use Errore by default during incremental adoption; read the skill only for tasks or code paths that explicitly opt in.
- [x] Keep runtime error behavior and public TypeScript signatures unchanged in this phase.
- [x] Run `pnpm check:mirrors`, `pnpm --filter libretto-browser-tools type-check`, `pnpm --filter libretto-browser-tools test`, and `pnpm -s lint`.

### Phase 1: Add the browser-open auth profile contract

Add the caller-facing input and provider capability contract without changing default sessions. Validate names as non-empty strings, pass the value only to providers that opt in, and return a next step when a provider does not support profiles.

```ts
// packages/browser-tools/src/provider.ts
import * as errore from "errore";

export class AuthProfileError extends errore.createTaggedError({
  name: "AuthProfileError",
  message: "$message $recovery",
}) {}

export type ProviderSessionCreateOptions = {
  authProfile?: string;
  startUrl?: string;
  gpu?: boolean;
  viewport?: { width: number; height: number };
};

export type BrowserProvider = {
  readonly name: string;
  readonly supportsAuthProfiles?: boolean;
  createSession(
    options?: ProviderSessionCreateOptions,
  ): Promise<AuthProfileError | ProviderSession>;
  ...
};

// packages/browser-tools/src/tools/open.ts
const openInputSchema = z.object({
  url: z.string().optional(),
  authProfile: z.union([z.string().min(1), z.literal(false)]).optional(),
});
```

- [x] Add `authProfile?: string | false` to `browser_open` and describe named, default, and unprofiled behavior.
- [x] Extend `BrowserProvider.createSession` with an optional typed options object and an opt-in `supportsAuthProfiles` capability.
- [x] Pass the selected profile from `createOpenTool()` through `SessionRegistry.openSession()` to the provider.
- [x] Add an exported Errore tagged `AuthProfileError` with a required recovery instruction; providers use it only for caller-fixable profile failures.
- [x] Let internal profile lookup and validation helpers return `AuthProfileError | T`, and propagate expected profile failures as values from `SessionRegistry.openSession()`.
- [x] Return `{ ok: false, error }` for unsupported profiles and returned `AuthProfileError` instances.
- [x] Keep host failures such as missing API keys, provider outages, and unknown errors as thrown errors.
- [x] Let `BrowserProvider.createSession()` return `AuthProfileError | ProviderSession` so expected profile failures remain values throughout the call chain.
- [x] Defer auth-profile behavior tests to provider phases, where they exercise real provider implementations instead of fake providers.
- [x] Run `pnpm --filter libretto-browser-tools type-check` and `pnpm --filter libretto-browser-tools test`.

### Phase 2: Make close semantics safe for profile persistence

Cloud providers save profile changes when their release, stop, or delete endpoint runs. Return typed cleanup errors as values, release the provider while the browser is still available, then detach the Playwright CDP client even if provider cleanup fails.

```ts
// packages/browser-tools/src/session-registry.ts
async closeSession(sessionId: string): Promise<BrowserCleanupError | null> {
  const entry = this.requireSession(sessionId);
  ...
  const providerResult = await this.provider?.closeSession(entry.providerSessionId);
  const browserResult = await entry.browser.close()
    .then(() => null)
    .catch((cause) => new BrowserCloseError({ ... }));
  const [, errors] = errore.partition([providerResult, browserResult]);
  return aggregateErrors(errors, `Failed to fully close session "${sessionId}".`);
}
```

- [x] Release a provider-owned session before closing its CDP connection.
- [x] Return `ProviderCloseError` values from every bundled provider instead of rejecting for expected close failures.
- [x] Return `BrowserCloseError | ProviderCloseError | AggregateError | null` from registry and toolkit cleanup APIs.
- [x] Use `errore.partition()` to collect cleanup error values and preserve multiple causes with native `AggregateError`.
- [x] Preserve existing behavior for attached CDP sessions and caller-owned pages.
- [x] Ensure failed provider cleanup still removes registry state and detaches the CDP client.
- [x] Make `dispose()` attempt every remaining session after one close fails, then report all cleanup failures.
- [x] Add a registry test whose fake provider records that it closes before the browser disconnects.
- [x] Add a failure-path test that confirms the session becomes unknown after provider cleanup throws.
- [x] Add a disposal test with two sessions that proves the second session closes when the first provider release fails.
- [x] Catch and log best-effort `beforeExit` disposal failures instead of creating an unhandled rejection.
- [x] Run `pnpm --filter libretto-browser-tools test -- src/session-registry.spec.ts`.

### Phase 3: Persist full local Chromium profiles

Opt `LocalBrowserProvider` into auth profiles. Launch profiled sessions with `chromium.launchPersistentContext()` and a stable, per-name user data directory under `~/.libretto/browser-tools/profiles` by default; keep unprofiled sessions ephemeral.

```ts
// packages/browser-tools/src/providers/local.ts
export type LocalBrowserProviderOptions = {
  ...
  authProfileDirectory?: string;
};

async createSession({ authProfile }: ProviderSessionCreateOptions = {}) {
  const context = authProfile
    ? await chromium.launchPersistentContext(
        resolveProfilePath(this.authProfileDirectory, authProfile),
        launchOptions,
      )
    : undefined;
  ...
}
```

- [x] Add `authProfileDirectory` for tests and hosts that need an explicit storage root.
- [x] Validate local profile names to allow letters, numbers, dots, underscores, and hyphens while rejecting path traversal.
- [x] Create profile directories with owner-only permissions, repair an existing profile directory to owner-only permissions before launch, and reject an existing symbolic-link profile path.
- [x] Use one persistent user data directory per profile and close the owned persistent context during provider release.
- [x] Keep the existing ephemeral launch path unchanged when `authProfile` is absent.
- [x] Preserve current URL behavior: when a restored profile has tabs, `browser_open({ url })` navigates one restored tab and leaves other tabs open.
- [x] Add focused tests for valid names, traversal rejection, symlink rejection, and owner-only directory creation.
- [x] Run the local provider spec and package type-check.

### Phase 4: Verify the local login round trip

Exercise the public tools against a local HTTP fixture. Keep these user-flow tests separate from local launch plumbing so both phases stay commit-sized.

- [x] Add a user-flow test: open a local profile, set cookie and local-storage login state, close, reopen the same profile, and assert both values remain.
- [x] Add a test that two different profile names do not share state.
- [x] Add a restored-tabs test that locks the documented `browser_open({ url })` behavior.
- [x] Run `pnpm --filter libretto-browser-tools test -- src/providers/local.spec.ts` and package type-check.

### Phase 5: Add named Libretto Cloud profiles

Map the common string to Libretto Cloud's named profile fields and request write-back so a manual login from the live view persists after `browser_close`.

```ts
// packages/browser-tools/src/providers/libretto-cloud.ts
async createSession({ authProfile }: ProviderSessionCreateOptions = {}) {
  return this.createCloudSession({
    ...this.sessionOptions,
    ...(authProfile ? {
      profile_name: authProfile,
      profile_persist: true,
    } : {}),
  });
}
```

- [x] Send Libretto Cloud `profile_name` and `profile_persist: true` when a profile is supplied.
- [x] Mark the provider as supporting auth profiles.
- [ ] Add live API coverage for profile persistence after the provider rollout is ready to test.
- [x] Keep close endpoints unchanged; Phase 2 makes them the persistence trigger.
- [x] Run the Libretto Cloud provider spec plus package type-check.

### Phase 6: Add named Kernel profiles

Create a named Kernel profile when needed, then attach it with write-back enabled. Kernel browser deletion remains the persistence trigger.

```ts
// packages/browser-tools/src/providers/kernel.ts
async createSession({ authProfile }: ProviderSessionCreateOptions = {}) {
  if (authProfile) await this.ensureProfileExists(authProfile);
  return this.createBrowser({
    ...
    ...(authProfile
      ? { profile: { name: authProfile, save_changes: true } }
      : {}),
  });
}
```

- [x] Ensure a named Kernel profile exists, treating an API conflict as “already exists.”
- [x] Send `profile: { name, save_changes: true }` when creating the browser.
- [x] Mark the provider as supporting auth profiles.
- [x] Add credential-gated live API tests for profile creation, reuse, and unprofiled sessions.
- [x] Keep browser deletion as the persistence trigger.
- [x] Run the Kernel provider spec plus package type-check.

### Phase 7: Add named Browser Use profiles

Resolve a profile by exact name and create it when absent, then start and stop the browser with the resulting provider ID. Reject ambiguous duplicate exact-name matches instead of choosing an account silently.

```ts
// packages/browser-tools/src/providers/browser-use.ts
async createSession({ authProfile }: ProviderSessionCreateOptions = {}) {
  const profileId = authProfile
    ? await this.findOrCreateProfileId(authProfile)
    : undefined;
  return this.createBrowser({ profileId, ...this.browserOptions });
}
```

- [x] Query every page of Browser Use profile search results for the requested name and require an exact-name match.
- [x] Create the named profile when no exact match exists.
- [x] Return an actionable error if more than one exact match exists.
- [x] Pass the resolved `profileId` when creating the browser and mark the provider as supporting profiles.
- [x] Keep the existing stop request as the persistence trigger.
- [x] Add one credential-gated live API test for profile creation and reuse, then run package type-check.

### Phase 8: Cover Browser Use profile resolution edges

Lock the cases most likely to select the wrong account or change unprofiled sessions. Run against the production Browser Use API when `BROWSER_USE_API_KEY` is available; do not stub the provider API. Profile creation and exact-name reuse are covered by Phase 7. A later-page production test is deferred because forcing a second result page would require creating more than 100 provider profiles.

- [x] Add credential-gated live API tests for duplicate exact matches and an unprofiled session.
- [x] Assert duplicate matches return an `AuthProfileError` with a recovery instruction.
- [x] Keep profile creation and exact-name reuse covered by the Phase 7 live test.
- [x] Defer later-page coverage rather than creating more than 100 production profiles.
- [x] Run the Browser Use provider spec.

### Phase 9: Make the default profile observable

Resolve omitted profile input to `default` at the public tool and registry boundary for providers with named profile support. Let callers pass `authProfile: false` for an unprofiled session. Keep direct `provider.createSession()` semantics unchanged. Store the resolved name with the session so agents can confirm which profile a browser uses.

- [x] Resolve an omitted `authProfile` to `default` when `supportsAuthProfiles` is true.
- [x] Keep an explicit profile name unchanged and let it override `default`.
- [x] Treat `authProfile: false` as an explicit request for an unprofiled session.
- [x] Keep direct `provider.createSession()` calls unchanged; the implicit default belongs to `browser_open`.
- [x] Keep unsupported providers unprofiled when callers omit `authProfile`; reject an explicit profile as they do now.
- [x] Store the resolved profile name on provider-owned registry entries without adding profile behavior to `browser_connect` or caller-owned pages.
- [x] Add `authProfile?: string` to no-argument `browser_status` session summaries. Set it to the resolved explicit or `default` name for supported provider-owned sessions; omit it for unsupported-provider sessions, `browser_connect`, and caller-owned pages.
- [x] Add status tests for explicit, implicit `default`, unsupported-provider, connected-CDP, and caller-owned-page sessions.
- [x] Update the Kernel and Browser Use unprofiled live tests to pass `authProfile: false`; add direct `provider.createSession()` and `closeSession()` coverage for their unchanged unprofiled request paths.
- [x] Add a direct-provider regression test proving omitted `authProfile` remains unprofiled when `createSession()` bypasses `browser_open`.
- [x] Run the registry and tool specs plus package type-check.

### Phase 10: Make browser-open guidance provider-aware

Tell the agent whether the configured provider supports named profiles. Supported providers describe the implicit `default` profile and save-on-close behavior; unsupported providers tell callers to omit `authProfile` or pass `false` for incognito.

- [x] Build the `browser_open` description from the configured provider capability.
- [x] For supported providers, state that omitting `authProfile` uses `default` and that changes save on close.
- [x] For unsupported providers, state that named auth profiles are unavailable and callers must omit `authProfile` or pass `false` for incognito.
- [x] Keep the existing actionable runtime error when a caller passes `authProfile` to an unsupported provider.
- [x] Run the tool specs plus package type-check.

### Phase 11: Verify Libretto Cloud profile persistence live

Complete the remaining cloud-provider gap with a production API round trip. Gate the test on `LIBRETTO_API_KEY` and clean up every browser session through a fixture even after assertion failures.

- [x] Add a credential-gated live test that opens a unique named Libretto Cloud profile, writes benign local-storage state, closes it, reopens it, and confirms restoration.
- [x] Use the public browser tools rather than calling provider internals for the persistence flow.
- [x] Keep the existing unprofiled Libretto Cloud smoke test.
- [x] Use a random `browser-tools-test-` profile name so the test cannot alter a user profile.
- [x] In fixture teardown, dispose every open toolkit session, then delete that exact profile through `/v1/browserProfiles/delete` even when disposal fails; aggregate and report both cleanup failures.
- [x] Close the first session explicitly before reopening so the test proves that `browser_close` triggers persistence.
- [x] Run the Libretto Cloud provider spec plus package type-check.

### Phase 12: Document and verify the complete user flow

Document the common named-profile workflow. Verify the local round trip automatically and run opt-in live tests for supported cloud providers when credentials are available.

- [x] Add a concise `browser_open({ authProfile: "..." })` example to `packages/browser-tools/README.md`.
- [x] Document that omitting `authProfile` uses the named `default` profile on supported providers.
- [x] Add a provider table that marks Local, Libretto Cloud, Kernel, and Browser Use as supported and Browserbase and Steel as unsupported.
- [x] Explain that Browserbase and Steel need a durable Libretto name-to-provider-ID mapping before they can support this contract.
- [x] State that profiles contain sensitive account access, should not be committed, and persist only after `browser_close` or graceful `dispose()`.
- [x] State that callers must not open concurrent writable sessions against one profile.
- [x] Run `pnpm --filter libretto-browser-tools test`.
- [x] Run `pnpm --filter libretto-browser-tools type-check`.
- [x] Run `pnpm -s lint`.
- [x] With available provider credentials, open a profile, set benign account state, close, reopen, and confirm restoration; skip unavailable providers rather than weakening automated request-contract tests.

### Phase 13: Migrate domain policy restrictions to Errore

Convert the existing `DomainPolicyRestricted` class to an Errore tagged error and use error values inside browser-tools. Preserve the current adapter boundary: framework consumers still receive a rejected promise containing the structured error.

```ts
// packages/browser-tools/src/domain-policy.ts
export class DomainPolicyRestricted extends errore.createTaggedError({
  name: "DomainPolicyRestricted",
  message: "$attemptedNavigationUrl is blocked by this toolkit's domain policy",
}) {
  readonly domainPolicy: DomainPolicyOptions;
  ...
}
```

- [ ] Reimplement `DomainPolicyRestricted` with `errore.createTaggedError()` while preserving its constructor, `domainPolicy`, `attemptedNavigationUrl`, message, name, and `instanceof` behavior.
- [ ] Return `DomainPolicyRestricted` values from internal policy checks instead of throwing them.
- [ ] Propagate policy errors as values through `SessionRegistry` and base tool implementations.
- [ ] Throw the same tagged error only at the existing AI SDK and Pi adapter compatibility boundaries.
- [ ] Update domain-policy, registry, tool, and adapter tests to prove structured fields survive and existing adapter consumers still receive rejected promises.
- [ ] Run `pnpm --filter libretto-browser-tools type-check`, `pnpm --filter libretto-browser-tools test`, and `pnpm -s lint`.

## Sanity checklist

- [ ] `browser_open` without `authProfile` uses `default` on supported providers and remains unprofiled on unsupported providers.
- [ ] `browser_open` with `authProfile: false` remains unprofiled on every provider.
- [ ] `browser_status` reports the resolved profile name for provider-owned sessions.
- [ ] The same local profile restores cookie and local-storage state after a full close and reopen.
- [ ] Different local profile names remain isolated.
- [ ] Every supported cloud provider sends its documented persistence fields and runs its required release or stop endpoint.
- [ ] Browserbase and Steel reject explicit named profiles with an actionable error.
- [ ] Caller-fixable profile failures return actionable tool results; host and provider failures still throw.
- [ ] Direct provider consumers narrow expected `AuthProfileError` values with `instanceof Error`; unexpected host failures still reject.
- [ ] `dispose()` attempts to close every session even when one profile save fails.
- [ ] Local profile paths cannot escape the configured root and use owner-only permissions.
- [ ] No profile data, provider ID mapping, or credential enters the repository.
