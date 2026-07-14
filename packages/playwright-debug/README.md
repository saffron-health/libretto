# libretto-playwright-debug

`libretto-playwright-debug` adds a Playwright debugging agent that investigates
failed runs on the supplied live page and automatically opens pull requests to
fix broken scripts. It preserves the page's browser context and treats debugger
infrastructure failures as best-effort results instead of replacing the original
automation error.

## Install

Add the package to the project that runs the Playwright automation:

```bash
pnpm add libretto-playwright-debug
```

The project must already depend on Playwright.

## Configure authentication

1. Open the [Libretto setup flow](https://libretto.sh/setup), install the
   Libretto GitHub App for the target repository, and create a Libretto Cloud
   API key.
2. Set `LIBRETTO_API_KEY` in the environment that runs the automation.
3. Set the API key for the configured model provider: `OPENAI_API_KEY` for an
   `openai/...` model or `ANTHROPIC_API_KEY` for an `anthropic/...` model.

Do not commit these keys to the repository.

For local development, you can pass `github.token`, set
`LIBRETTO_GITHUB_TOKEN`, or set `GITHUB_TOKEN` instead of using the hosted
GitHub App. The token needs permission to read and write repository contents
and open pull requests.

## Add it to the existing failure path

Create one debugger instance at module scope, then call it directly from the
existing error boundary while the failed `Page` is still open:

```ts
import { createPlaywrightDebugger } from "libretto-playwright-debug";

const playwrightDebugger = createPlaywrightDebugger({
  github: {
    owner: "acme",
    repo: "automations",
    baseBranch: "main",
  },
  agent: {
    model: "openai/gpt-5.4",
  },
});

try {
  await runAutomation(page);
} catch (error) {
  await playwrightDebugger.debugPlaywrightFailure(error, page);
  // Keep any existing fallback or logging here.
  throw error;
}
```

Keep the call before any `finally` block or teardown that closes the page,
context, or browser. Await the debugger so it can inspect the live failure
state. Continue the existing fallback and rethrow behavior afterward.

`debugPlaywrightFailure()` uses stack frames to find source files. When the
stack does not identify every relevant file, pass repository-relative paths:

```ts
await playwrightDebugger.debugPlaywrightFailure(error, page, {
  includeFiles: ["src/workflows/checkout.ts"],
});
```

## Instructions for coding agents

When installing this package in an existing codebase:

1. Find the current runner or error boundary where both the thrown error and the
   failed Playwright `Page` are available.
2. Add `createPlaywrightDebugger()` once at module scope.
3. Add one awaited `debugPlaywrightFailure(error, page)` call to that existing
   failure path, before Playwright teardown.
4. Preserve the automation, fallback, retry, logging, and rethrow behavior
   around the new call.
5. Configure secrets in the project's existing secret-management system.

Do not create `withPlaywrightDebugger`, `debugWorkflow`, a replacement workflow,
or another debugger-agent abstraction. The object returned by
`createPlaywrightDebugger()` is the integration boundary. Do not launch a new
browser or page for the debugger; pass the live page that observed the failure.
