# @libretto/playwright-debug

`@libretto/playwright-debug` opens GitHub autofix pull requests from failed
Playwright runs.

```ts
import { createLibrettoDebugger } from "@libretto/playwright-debug";

const librettoDebugger = createLibrettoDebugger({
  github: {
    owner: "acme",
    repo: "automations",
    baseBranch: "main",
    installationId: process.env.LIBRETTO_GITHUB_INSTALLATION_ID,
  },
  agent: {
    model: "openai/gpt-5.4",
  },
  mode: "open_pr",
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

For GitHub, pass `github.token`, set `LIBRETTO_GITHUB_TOKEN`, or configure a
Libretto Cloud API key so Libretto can broker a token from the public GitHub
App:

- `LIBRETTO_API_KEY`
- `LIBRETTO_GITHUB_INSTALLATION_ID`

For self-hosted deployments, configure your own GitHub App with:

- `LIBRETTO_GITHUB_APP_ID`
- `LIBRETTO_GITHUB_PRIVATE_KEY`
- `LIBRETTO_GITHUB_INSTALLATION_ID`

The GitHub App needs read/write Contents permission, read/write Pull requests
permission, and read Metadata permission for the target repository.
