# Libretto

AI-powered browser automation library and CLI built on Playwright.

## Installation

```bash
pnpm add libretto playwright zod
npx libretto init
```

> **pnpm users:** if your workspace uses `onlyBuiltDependencies`, add both
> `libretto` and `playwright` to allow their postinstall scripts to run
> (libretto's postinstall copies skill files and installs Playwright Chromium):
>
> ```jsonc
> // package.json
> {
>   "pnpm": {
>     "onlyBuiltDependencies": ["libretto", "playwright"]
>   }
> }
> ```
>
> If the postinstall was skipped (e.g., `libretto` wasn't in the allowlist),
> run `npx libretto init` manually after install to complete setup.

## Quick Start

### 1. Configure your LLM

The easiest way is to use the built-in Vercel AI SDK adapter with any compatible provider:

```typescript
import { createLLMClientFromModel } from "libretto/llm";
import { openai } from "@ai-sdk/openai";

const llmClient = createLLMClientFromModel(openai("gpt-4o"));
```

Or use any other provider:

```typescript
import { createLLMClientFromModel } from "libretto";
import { anthropic } from "@ai-sdk/anthropic";

const llmClient = createLLMClientFromModel(anthropic("claude-sonnet-4-20250514"));
```

You can also implement the `LLMClient` interface directly for full control:

```typescript
import type { LLMClient } from "libretto";

const llmClient: LLMClient = {
  async generateObject({ prompt, schema, temperature }) {
    // Call your LLM, return parsed + validated result
  },
  async generateObjectFromMessages({ messages, schema, temperature }) {
    // Call your LLM with message history (may include images)
  },
};
```

### 2. Write a workflow

```typescript
import { workflow } from "libretto";
import { z } from "zod";

export default workflow({
  name: "extract-product",
  schema: z.object({ url: z.string() }),
  handler: async (ctx) => {
    const page = ctx.page;
    await page.goto(ctx.params.url);

    const data = await ctx.extract({
      instruction: "Extract the product name and price",
      schema: z.object({ name: z.string(), price: z.number() }),
    });

    return data;
  },
});
```

### 3. Run it

```bash
npx libretto run ./workflows/extract-product.ts extractProduct \
  --params '{"url": "https://example.com/product"}'
```

## CLI Commands

```
npx libretto init                  # Copy skills, install Playwright Chromium
npx libretto open <url>            # Launch browser and open URL
npx libretto run <file> <export>   # Run a workflow
npx libretto ai configure <preset> # Configure AI runtime (codex, claude, gemini)
npx libretto snapshot              # Capture page screenshot + HTML
npx libretto exec <code>           # Execute Playwright code
```

Run `npx libretto help` for the full list.

## Module Exports

| Import                     | Contents                                                      |
| -------------------------- | ------------------------------------------------------------- |
| `libretto`                 | Everything                                                    |
| `libretto/llm`             | `LLMClient` type, `createLLMClient`, `createLLMClientFromModel` |
| `libretto/recovery`        | `attemptWithRecovery`, `executeRecoveryAgent`, `detectSubmissionError` |
| `libretto/extract`         | `extractFromPage`                                             |
| `libretto/network`         | `pageRequest`                                                 |
| `libretto/download`        | `downloadViaClick`, `downloadAndSave`                         |
| `libretto/logger`          | `Logger`, `defaultLogger`, sinks                              |
| `libretto/debug`           | `debugPause`                                                  |
| `libretto/config`          | `isDryRun`, `isDebugMode`, `shouldPauseBeforeMutation`        |
| `libretto/instrumentation` | `instrumentPage`, `installInstrumentation`                    |
| `libretto/visualization`   | Ghost cursor and highlight helpers                            |
| `libretto/run`             | `launchBrowser`                                               |
| `libretto/state`           | Session state serialization and parsing                       |

## Using Recovery Helpers

The recovery module (`libretto/recovery`) provides `detectSubmissionError` and
`executeRecoveryAgent` for handling form submission errors. Both accept an
`LLMClient` — create one with `createLLMClientFromModel` and pass it directly:

```typescript
import { detectSubmissionError, executeRecoveryAgent } from "libretto/recovery";
import { createLLMClientFromModel } from "libretto/llm";
import { openai } from "@ai-sdk/openai";

const llmClient = createLLMClientFromModel(openai("gpt-4o"));

// Detect if a submission produced an error
const error = await detectSubmissionError(
  page, submissionError, "eligibility check failed", llmClient, knownErrors, logger,
);

// Or run the full recovery agent to retry with corrections
const result = await executeRecoveryAgent(
  page, error, llmClient, recoveryOptions, logger,
);
```

No need to write custom wrappers — `createLLMClientFromModel` bridges any
Vercel AI SDK provider into the `LLMClient` interface that recovery helpers expect.

## Links

- [GitHub](https://github.com/saffron-health/libretto)
- [Issues](https://github.com/saffron-health/libretto/issues)
