# Libretto

A TypeScript library for browser automation with AI-powered recovery and data extraction. Built on Playwright.

## Features

- **AI-powered recovery** — Vision-based agent that automatically detects and dismisses popups or obstacles using an LLM
- **Structured data extraction** — Extract typed data from web pages using AI vision + Zod schemas
- **Error detection** — Classify form/submission errors against known patterns
- **In-browser network requests** — Execute authenticated fetch calls inside the page context with optional Zod validation
- **File downloads** — Trigger and intercept file downloads via click, with optional save-to-disk
- **Dry-run mode** — Skip mutations in development without side effects
- **Pluggable LLM** — Bring your own LLM provider (Claude, GPT, etc.) via a simple interface
- **Pluggable logging** — All runtime functions accept an optional logger; defaults to console output

## Installation

```bash
pnpm add libretto playwright zod
```

`playwright` and `zod` are peer dependencies.

## Quick Start

```typescript
import { chromium } from "playwright";
import { extractFromPage, attemptWithRecovery } from "libretto";

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto("https://example.com/login");
await page.fill("#email", "user@example.com");
await page.fill("#password", "secret");

// Automatically retry with AI popup recovery on failure
await attemptWithRecovery(page, () => page.click('button[type="submit"]'));

await browser.close();
```

## Runtime Functions

### Recovery

#### `attemptWithRecovery(page, fn, logger?, llmClient?)`

Executes a function and, if it fails, uses AI vision to detect and dismiss popups before retrying once.

```typescript
import { attemptWithRecovery } from "libretto";

await attemptWithRecovery(page, async () => {
  await page.click('button[type="submit"]');
}, undefined, llmClient);
```

#### `executeRecoveryAgent(page, instruction, logger?, llmClient?)`

Runs a multi-step vision-based recovery agent that takes screenshots and executes browser actions (click, type, scroll, etc.) to resolve obstacles.

```typescript
import { executeRecoveryAgent } from "libretto";

await executeRecoveryAgent(
  page,
  "Close the cookie consent banner",
  undefined,
  llmClient,
);
```

#### `detectSubmissionError(page, error, logContext, llmClient, knownErrors?, logger?)`

Uses a screenshot + LLM vision to detect if an error occurred during a form submission. Matches against provided known error patterns.

```typescript
import { detectSubmissionError } from "libretto";

try {
  await page.click("#submit");
} catch (error) {
  const result = await detectSubmissionError(page, error, "checkout", llmClient, [
    { id: "duplicate", errorPatterns: ["already exists"], userMessage: "Duplicate entry" },
  ]);
  console.log(result.errorId, result.message);
}
```

### Data Extraction

#### `extractFromPage(options)`

Extract structured data from a page using AI vision + a Zod schema.

```typescript
import { extractFromPage } from "libretto";
import { z } from "zod";

const result = await extractFromPage({
  page,
  llmClient,
  instruction: "Extract the product name and price",
  schema: z.object({
    name: z.string(),
    price: z.number(),
  }),
  selector: ".product-card", // optional — scopes to a specific element
});
// result is typed as { name: string; price: number }
```

### Network

#### `pageRequest(page, config, options?)`

Executes a fetch call inside the browser context via `page.evaluate()`, inheriting the page's cookies and auth state. Supports optional Zod validation.

```typescript
import { pageRequest } from "libretto";
import { z } from "zod";

const data = await pageRequest(
  page,
  {
    url: "https://example.com/api/profile",
    method: "GET",
    responseType: "json",
  },
  {
    schema: z.object({ name: z.string(), email: z.string() }),
  },
);
```

### Downloads

#### `downloadViaClick(page, selector, options?)`

Triggers a file download by clicking a DOM element and intercepts the result.

```typescript
import { downloadViaClick } from "libretto";

const { buffer, filename } = await downloadViaClick(page, "#download-btn");
```

#### `downloadAndSave(page, selector, options?)`

Same as `downloadViaClick` but also writes the file to disk.

```typescript
import { downloadAndSave } from "libretto";

const { savedTo } = await downloadAndSave(page, "#export-csv", {
  savePath: "./exports/report.csv",
});
```

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

## Logging

All runtime functions accept an optional `logger` parameter. When omitted, output goes to `console.log` with `[INFO]`, `[WARN]`, `[ERROR]` prefixes.

For structured logging, use the built-in `Logger` class:

```typescript
import { Logger, createFileLogSink, prettyConsoleSink } from "libretto";

const logger = new Logger()
  .withSink(createFileLogSink({ filePath: "./app.log" }))
  .withSink(prettyConsoleSink);

const scoped = logger.withScope("auth");
scoped.info("login attempt", { user: "alice" });
scoped.error("login failed", { reason: "bad password" });
```

## Module Exports

Libretto provides granular imports:

| Import                   | Contents                                                  |
| ------------------------ | --------------------------------------------------------- |
| `libretto`               | Everything                                                |
| `libretto/logger`        | `Logger`, `defaultLogger`, sinks                          |
| `libretto/recovery`      | `attemptWithRecovery`, `executeRecoveryAgent`, `detectSubmissionError` |
| `libretto/extract`       | `extractFromPage`                                         |
| `libretto/network`       | `pageRequest`                                             |
| `libretto/download`      | `downloadViaClick`, `downloadAndSave`                     |
| `libretto/debug`         | `debugPause`                                              |
| `libretto/config`        | `isDryRun`, `isDebugMode`, `shouldPauseBeforeMutation`    |
| `libretto/instrumentation` | `instrumentPage`, `installInstrumentation`              |
| `libretto/visualization` | Ghost cursor and highlight helpers                        |
| `libretto/run`           | `launchBrowser`                                           |
| `libretto/state`         | Session state serialization and parsing                   |
| `libretto/llm`           | `LLMClient` type                                          |

## Configuration

Runtime flags via environment variables:

| Env Variable          | Effect                                              |
| --------------------- | --------------------------------------------------- |
| `LIBRETTO_DEBUG`      | Enable debug mode                                   |
| `LIBRETTO_DRY_RUN`   | Enable dry-run mode (defaults to `true` in development) |

## Development

```bash
pnpm install
pnpm build         # compile to dist/
pnpm type-check    # typecheck without emitting
```
