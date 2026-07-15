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

Store both keys in the project's existing secret-management system.

## Add it to the existing failure path

Initialize the debugger once at module scope:

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
```

At the existing failure point, await `debugFailure()` before teardown closes
the failed `Page`:

```ts
try {
  await runAutomation(page);
} catch (error) {
  await playwrightDebugger.debugFailure(error, page);
  // Existing fallback and logging stay here.
  throw error;
}
```

Use the `Page` that observed the failure. Keep the existing automation,
fallback, retry, logging, and rethrow behavior in place around the new call.

`debugFailure()` uses stack frames to find source files. When the stack does not
identify every relevant file, pass repository-relative paths:

```ts
await playwrightDebugger.debugFailure(error, page, {
  includeFiles: ["src/workflows/checkout.ts"],
});
```
