# @libretto/playwright-debug

`@libretto/playwright-debug` adds a Playwright debugging agent that investigates
failed runs on the supplied live page and automatically opens pull requests to
fix broken scripts. It preserves the page's browser context and treats debugger
infrastructure failures as best-effort results instead of replacing the original
automation error.

```ts
import { createLibrettoDebugger } from "@libretto/playwright-debug";

const librettoDebugger = createLibrettoDebugger({
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
  await librettoDebugger.debugPlaywrightFailure(error, page);
  throw error;
}
```

## Authentication

For model calls, use the provider's normal API key environment variable:

- `OPENAI_API_KEY` for `openai/...`
- `ANTHROPIC_API_KEY` for `anthropic/...`

For GitHub, use the [Libretto setup flow](https://libretto.sh/setup) to connect
the repository, then configure the generated Libretto Cloud API key:

- `LIBRETTO_API_KEY`

Libretto Cloud mints the short-lived GitHub installation token needed to read
contents, write contents, and open pull requests. For local development, you can
also pass `github.token`, set `LIBRETTO_GITHUB_TOKEN`, or set `GITHUB_TOKEN`.
