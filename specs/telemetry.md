## Problem overview

Libretto has no anonymous visibility into CLI usage or command failures. That makes it hard to tell which commands are actually used, whether new CLI work is causing failures, and where to prioritize fixes.

The existing files named `telemetry.ts` and `session-telemetry.ts` are local browser-session logging: action logs, network logs, and Playwright instrumentation. This spec is for a separate, anonymous CLI usage telemetry path that records only a device-local install id, a timestamp, a command event name, and whether that command failed.

## Solution overview

Add a small anonymous telemetry pipeline that spans Libretto and the hosted platform:

- In Libretto, create one CLI telemetry module at `packages/libretto/src/cli/core/telemetry.ts`.
- Store a random install id in `~/.libretto/telemetry.json`; do not read auth state, API keys, git remotes, usernames, project paths, command args, or environment details.
- Send one best-effort event per successfully resolved CLI command through a small SimpleCLI middleware change so handlers do not call telemetry directly.
- In the hosted platform (`../browser-automations`), add a public, rate-limited ingestion route that validates and stores the anonymous event.
- Disclose the behavior in `packages/libretto/README.template.md`, then sync mirrors.

Because `packages/libretto/src/cli/core/telemetry.ts` already exists for local browser action/network logs, rename that existing module before adding the new CLI telemetry module. The new telemetry module should be the only Libretto file that knows how install ids are stored, how events are shaped, how opt-out works, and where the hosted endpoint lives.

## Goals

- A Libretto CLI user gets one random, device-local install id stored outside project state.
- Libretto records anonymous CLI command events with only `{ installId, timestamp, event, error }`.
- CLI telemetry is emitted centrally through SimpleCLI middleware, not scattered across command handlers.
- Telemetry failure never changes command output, command exit code, or command latency beyond a small timeout budget.
- The hosted platform accepts anonymous telemetry without requiring a Libretto Cloud account or API key.
- The README clearly discloses what is collected, what is not collected, and how to opt out.

## Non-goals

- No backfills; a forward schema migration is expected for the new hosted table.
- No user, tenant, email, API-key, project, repository, file-path, command-argument, session, page, URL, DOM, network, stdout, stderr, stack trace, hostname, OS username, or IP persistence in the telemetry table.
- No dashboard, reporting UI, or analytics queries in v1.
- No SDK/runtime telemetry; this is CLI-only.
- No browser-session action/network log changes beyond renaming the existing file to avoid the `telemetry.ts` name collision.
- No interactive consent prompt in v1.

## Privacy contract

The v1 payload is intentionally narrow:

```json
{
  "installId": "random-uuid-generated-on-this-device",
  "timestamp": "2026-06-04T12:34:56.789Z",
  "event": "libretto run",
  "error": false
}
```

Rules:

- `installId` is generated with `crypto.randomUUID()` and persisted in `~/.libretto/telemetry.json` with user-only permissions.
- `timestamp` is the client-side event time in ISO-8601 format.
- `event` is derived only from the resolved command path, such as `libretto run` or `libretto cloud auth login`.
- `error` is `true` when resolved-command middleware or the command handler throws and `false` otherwise.
- Help/version/root-help invocations and unknown-command parse failures do not need telemetry in v1 because they do not resolve to a command handler.
- `LIBRETTO_TELEMETRY_DISABLED=1` disables install-id creation and event sending.
- The hosted API must not store auth headers, IP addresses, user agents, request paths beyond the route, or raw request bodies for this endpoint. Normal Cloud Run access logs may still exist outside this application table.

## Important files/docs/websites for implementation

- `packages/affordance/src/index.ts` - SimpleCLI middleware execution currently runs only before handlers; telemetry needs the minimal `next()` support required to observe success and failure centrally, plus app-level middleware registration.
- `packages/affordance/test/affordance.spec.ts` - focused tests for middleware ordering and error propagation.
- `packages/libretto/src/cli/router.ts` - creates the Libretto CLI app and is the natural place to install root-level telemetry middleware.
- `packages/libretto/src/cli/cli.ts` - CLI bootstrap, help/version bypasses, and exit-code handling.
- `packages/libretto/src/cli/core/telemetry.ts` - currently browser action/network logging; rename this to avoid colliding with anonymous CLI telemetry.
- `packages/libretto/src/cli/core/session-telemetry.ts` - local browser-session telemetry instrumentation; should stay separate from anonymous CLI usage telemetry.
- `packages/libretto/src/cli/core/auth-storage.ts` - existing pattern for storing device-local Libretto state under `~/.libretto` with restricted file permissions.
- `packages/libretto/src/cli/core/auth-fetch.ts` - source of truth for hosted API URL resolution via `LIBRETTO_API_URL`; telemetry should reuse the base URL convention without auth.
- `packages/libretto/src/cli/commands/execution.ts` and `packages/libretto/src/cli/core/daemon/daemon.ts` - imports that must be updated when the current browser-log `telemetry.ts` file is renamed.
- `packages/libretto/README.template.md` - source of truth for README disclosure; run `pnpm sync:mirrors` after editing.
- `docs/tests-guide.md` - Libretto test guidance; prefer user-level CLI assertions and do not assert low-value internal output formatting.
- `../browser-automations/api/src/app.ts` - Hono app setup, public route rate limiting, and ORPC catch-all mounting.
- `../browser-automations/api/src/orpc.ts` - `pub` ORPC builder for unauthenticated routes.
- `../browser-automations/api/src/routes/router.ts` - hosted ORPC route tree.
- `../browser-automations/packages/db/src/schema/appSchema.ts` - Drizzle app schema for adding the anonymous telemetry table.
- `../browser-automations/packages/db/drizzle/` - generated SQL migrations for hosted schema changes.
- `../browser-automations/api/test/*.spec.ts` - route handler test patterns that call ORPC handlers directly with mocked DB clients.

## Implementation

### Phase 1: Add only the SimpleCLI middleware behavior telemetry needs

Do not implement the broader affordance v2 middleware redesign in this branch. Make the smallest SimpleCLI changes that let telemetry wrap a resolved command centrally while preserving existing context-return middleware such as `withRequiredSession()` and `withAutoSession()`.

Telemetry needs two affordance capabilities:

- Middleware can call `await next()` and run code before and after downstream middleware and the handler.
- `SimpleCLI.define()` can accept app-level middlewares that run once for every resolved command before inherited group and command middleware.

```ts
// packages/affordance/src/index.ts
export type SimpleCLIMiddleware<TInput, TContextIn, TContextOut> = (
  args: SimpleCLIMiddlewareArgs<TInput, TContextIn> & {
    next: (options?: { ctx?: Partial<TContextOut> }) => Promise<unknown>;
  },
) => Promise<unknown> | unknown;

type SimpleCLIAppConfig = {
  globalNamed?: SimpleCLINamedDefinition;
  appendHelpText?: string;
  middlewares?: AnySimpleCLIMiddleware[];
};
```

- [ ] Add a `next()` function to middleware args and compose middleware so a caller can run before and after `await next()`.
- [ ] Ensure `next()` rejects with downstream handler errors unless an intermediate middleware catches them.
- [ ] Ensure middleware can inject downstream context with `next({ ctx })`.
- [ ] Preserve existing legacy middleware behavior where returning a context object without calling `next()` merges that context and continues to the next middleware or handler.
- [ ] Add `middlewares` to `SimpleCLI.define()` config and run those app-level middlewares only after a command route resolves, before route-tree middleware.
- [ ] Do not add unrelated affordance v2 features, new routing APIs, or a separate around-middleware API.
- [ ] Verify `pnpm -s --filter affordance test` passes.

### Phase 2: Add hosted anonymous telemetry ingestion

Create the storage and unauthenticated ingestion route in `../browser-automations`. The route should validate the narrow payload, insert it, and return `{ success: true }`; it should not require or inspect Libretto Cloud auth.

```ts
// ../browser-automations/api/src/routes/telemetry/recordCliEvent.ts
const input = z.object({
  installId: z.string().uuid(),
  timestamp: z.string().datetime(),
  event: z.string().min(1).max(80),
  error: z.boolean(),
});

export const recordCliTelemetryEventRoute = pub
  .input(input)
  .output(z.object({ success: z.literal(true) }))
  .handler(async ({ input, context }) => {
    const db = createDatabaseClientWithoutTenant(context.executorAdminPool);
    await db.insert(cliTelemetryEvents).values({
      installId: input.installId,
      occurredAt: new Date(input.timestamp),
      event: input.event,
      error: input.error,
    });
    return { success: true as const };
  });
```

- [ ] Add `cliTelemetryEvents` to `../browser-automations/packages/db/src/schema/appSchema.ts` with columns `id`, `installId`, `occurredAt`, `event`, `error`, and `createdAt`.
- [ ] Generate and review a Drizzle migration for the new table.
- [ ] Add `api/src/routes/telemetry/recordCliEvent.ts` using the unauthenticated `pub` builder.
- [ ] Register the route under `telemetry.recordCliEvent` in `api/src/routes/router.ts`.
- [ ] Add a rate limiter for `/v1/telemetry/*` in `api/src/app.ts` before the ORPC catch-all.
- [ ] Add focused API tests that valid payloads insert exactly those four client fields plus server timestamps, and invalid payloads are rejected before insert.
- [ ] Verify the hosted API package tests covering the new route pass.

### Phase 3: Centralize Libretto CLI telemetry in `core/telemetry.ts`

Rename the existing local browser log module, then create the new anonymous CLI telemetry module at the requested central path. The module should own install-id persistence, opt-out detection, payload creation, endpoint calls, timeout handling, and swallow-on-failure behavior.

```ts
// packages/libretto/src/cli/core/telemetry.ts
export function createTelemetryMiddleware(): SimpleCLIMiddleware<unknown, {}, {}> {
  return async ({ command, next }) => {
    try {
      const result = await next();
      await recordCliTelemetryEvent(command, false).catch(() => {});
      return result;
    } catch (error) {
      await recordCliTelemetryEvent(command, true).catch(() => {});
      throw error;
    }
  };
}

async function recordCliTelemetryEvent(
  command: SimpleCLICommandMeta,
  error: boolean,
): Promise<void> {
  if (isTelemetryDisabled()) return;
  await sendWithTimeout({
    installId: await readOrCreateInstallId(),
    timestamp: new Date().toISOString(),
    event: `libretto ${command.path.join(" ")}`,
    error,
  });
}
```

- [ ] Rename the current `packages/libretto/src/cli/core/telemetry.ts` to a browser-log-specific name such as `session-logs.ts`.
- [ ] Update imports in `packages/libretto/src/cli/commands/execution.ts`, `packages/libretto/src/cli/core/daemon/daemon.ts`, and any other references to the renamed browser-log module.
- [ ] Create a new `packages/libretto/src/cli/core/telemetry.ts` for anonymous CLI telemetry.
- [ ] Store the install id at `~/.libretto/telemetry.json` using an atomic temp-file write and mode `0600`, matching the auth-storage style.
- [ ] Implement `LIBRETTO_TELEMETRY_DISABLED=1` so disabled telemetry does not create the install-id file.
- [ ] Send to `${resolveHostedApiUrl()}/v1/telemetry/recordCliEvent` with the ORPC JSON envelope, no auth headers, and a short timeout, for example 250 ms.
- [ ] Catch and ignore all telemetry errors so command behavior is unchanged when the network is offline or the hosted API fails.
- [ ] Add unit coverage for install-id reuse, opt-out behavior, payload shape, and swallow-on-failure behavior.
- [ ] Verify `pnpm -s --filter libretto type-check` passes.

### Phase 4: Install telemetry middleware in the CLI router

Apply the telemetry middleware once at the SimpleCLI app boundary. Command handlers should remain unaware of telemetry.

```ts
// packages/libretto/src/cli/router.ts
import { createTelemetryMiddleware } from "./core/telemetry.js";

export function createCLIApp() {
  return SimpleCLI.define("libretto", cliRoutes, {
    middlewares: [createTelemetryMiddleware()],
    appendHelpText: [
      ...
    ].join("\n"),
  });
}
```

- [ ] Install the telemetry middleware in `createCLIApp()`.
- [ ] Ensure `libretto help`, root help, `--version`, and unknown-command parse failures do not create an event unless a command route resolves.
- [ ] Add CLI-level tests for a successful command event and a failing command event using a mocked telemetry transport.
- [ ] Verify command failures still print the original error and exit non-zero.
- [ ] Verify telemetry transport failures do not change command output.
- [ ] Run the smallest relevant Libretto CLI test target, then `pnpm -s type-check` if the affordance API changes require broader type validation.

### Phase 5: Disclose telemetry in README and sync mirrors

Document the anonymous telemetry behavior near the README configuration or CLI usage section. Keep the disclosure short and specific.

- [ ] Update `packages/libretto/README.template.md` with:
  - [ ] the exact collected fields: install id, timestamp, command event, error boolean,
  - [ ] examples of excluded data: command args, URLs, project paths, auth state, API keys, user identity,
  - [ ] the install id location: `~/.libretto/telemetry.json`,
  - [ ] the opt-out: `LIBRETTO_TELEMETRY_DISABLED=1`.
- [ ] Run `pnpm sync:mirrors` so generated READMEs stay in sync.
- [ ] Verify `pnpm check:mirrors` passes.
