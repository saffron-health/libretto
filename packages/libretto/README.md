# Libretto

A TypeScript library for browser automation with AI-powered recovery and data extraction. Built on Playwright.

## Features

- **Step-based workflows** — Define automation as named steps with built-in error handling and recovery
- **AI-powered recovery** — Vision-based agent that automatically detects and dismisses popups or obstacles using an LLM
- **Structured data extraction** — Extract typed data from web pages using AI vision + Zod schemas
- **Error detection** — Classify form/submission errors against known patterns
- **Debug bundles** — On failure, captures screenshots, DOM, logs, and step history for investigation
- **Dry-run mode** — Run workflows in simulation without side effects
- **Pluggable LLM** — Bring your own LLM provider (Claude, GPT, etc.) via a simple interface

## Installation

```bash
pnpm add libretto playwright zod
```

`playwright` and `zod` are peer dependencies.

## Quick Start

```typescript
import { chromium } from "playwright";
import { step, createRunner } from "libretto";

const runner = createRunner({
  llmClient: myLLMClient, // optional — enables AI recovery & extraction
});

const steps = [
  step("navigate", async ({ page, logger }) => {
    await page.goto("https://example.com/login");
    logger.info("navigated to login page");
  }),

  step("login", async ({ page }) => {
    await page.fill("#email", "user@example.com");
    await page.fill("#password", "secret");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard");
  }),

  step("scrape-data", async ({ page, logger }) => {
    const title = await page.textContent("h1");
    logger.info("page title", { title });
  }),
];

const browser = await chromium.launch();
const page = await browser.newPage();
await runner.run(page, steps);
await browser.close();
```

## Core Concepts

### Steps

A step is a named unit of work. Create one with the `step()` factory:

```typescript
step("step-name", async ({ page, logger, config }) => {
  // page:   Playwright Page instance
  // logger: scoped logger for this step
  // config: { dryRun, debug, logDir }
});
```

### Step Options

```typescript
step("submit-form", handler, {
  dryRun: "skip",      // "skip" (default) | "execute" | "simulate"
  simulate: async ({ logger }) => {
    logger.info("simulated form submission");
  },
  recovery: {
    "session-expired": async ({ page, logger }) => {
      await page.click("#re-login");
    },
  },
});
```

- **`dryRun`** — Controls behavior when the runner is in dry-run mode:
  - `"skip"` — Skip the step entirely
  - `"execute"` — Run normally even in dry-run mode
  - `"simulate"` — Call the `simulate` function instead
- **`recovery`** — Named recovery handlers tried after AI recovery fails

### Extending Steps

Use `step.extend()` to create a step factory with shared recovery handlers:

```typescript
const myStep = step.extend({
  recovery: {
    "cookie-banner": async ({ page }) => {
      await page.click("#accept-cookies");
    },
  },
});

// Every step created with myStep inherits the cookie-banner recovery
myStep("checkout", async ({ page }) => { /* ... */ });
```

### Runner

```typescript
import { createRunner } from "libretto";

const runner = createRunner({
  llmClient,            // optional — enables AI recovery & extraction
  dryRun: false,        // run in dry-run mode
  debug: false,         // enable debug mode
  logDir: "./logs",     // defaults to .libretto/sessions/<sessionName>/logs
});

await runner.run(page, steps);
```

The runner executes steps sequentially. For each step it:
1. Captures a start screenshot
2. Runs the handler with automatic popup recovery (if `llmClient` provided)
3. Falls back to custom recovery handlers on failure
4. Generates a debug bundle if all recovery fails
5. Captures an end screenshot

## LLM Client Interface

Provide your own implementation backed by any LLM provider:

```typescript
import type { LLMClient } from "libretto";

const myLLMClient: LLMClient = {
  async generateObject({ prompt, schema, temperature }) {
    // Call your LLM, return parsed + validated result
  },
  async generateObjectFromMessages({ messages, schema, temperature }) {
    // Call your LLM with message history, return parsed + validated result
  },
};
```

## Data Extraction

Extract structured data from a page using AI vision:

```typescript
import { extractFromPage } from "libretto/extract";
import { z } from "zod";

const result = await extractFromPage(page, llmClient, {
  prompt: "Extract the product name and price from this page",
  schema: z.object({
    name: z.string(),
    price: z.number(),
  }),
});
// result is typed as { name: string; price: number }
```

## Error Detection

Detect and classify form submission errors:

```typescript
import { detectSubmissionError } from "libretto/recovery";

const error = await detectSubmissionError(page, llmClient, [
  { name: "duplicate-entry", description: "Record already exists" },
  { name: "invalid-field", description: "A form field has a validation error" },
]);

if (error) {
  console.log(error.name, error.details);
}
```

## Logging

```typescript
import { Logger, createFileLogSink, prettyConsoleSink } from "libretto/logger";

const logger = new Logger()
  .withSink(createFileLogSink({ filePath: "./app.log" }))
  .withSink(prettyConsoleSink);

const scoped = logger.withScope("auth");
scoped.info("login attempt", { user: "alice" });
scoped.error("login failed", { reason: "bad password" });
```

## Module Exports

Libretto provides granular imports:

| Import                   | Contents                                      |
| ------------------------ | --------------------------------------------- |
| `libretto`               | Everything                                    |
| `libretto/step`          | `step`, `createRunner`                        |
| `libretto/logger`        | `Logger`, sinks                               |
| `libretto/recovery`      | `attemptWithRecovery`, `detectSubmissionError` |
| `libretto/extract`       | `extractFromPage`                             |
| `libretto/network`       | `pageRequest`                                 |
| `libretto/debug`         | `debugPause`                                  |
| `libretto/config`        | `isDryRun`, `isDebugMode`, etc.               |

## Configuration

Runtime flags can be set via runner config or environment variables:

| Env Variable          | Effect                   |
| --------------------- | ------------------------ |
| `LIBRETTO_DEBUG`      | Enable debug mode        |
| `LIBRETTO_DRY_RUN`   | Enable dry-run mode      |

## Development

```bash
pnpm install
pnpm build         # compile to dist/
pnpm type-check    # typecheck without emitting
```
