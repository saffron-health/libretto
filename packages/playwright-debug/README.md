# @libretto/playwright-debug

`@libretto/playwright-debug` opens GitHub autofix pull requests from failed
Playwright runs.

```ts
import {
  createLibrettoDebugger,
  createLibrettoGitHubConnectUrl,
} from "@libretto/playwright-debug";

console.log(
  await createLibrettoGitHubConnectUrl({
    owner: "acme",
    repo: "automations",
  }),
);

const librettoDebugger = createLibrettoDebugger({
  github: {
    owner: "acme",
    repo: "automations",
    baseBranch: "main",
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

For GitHub, link the repository to the public Libretto GitHub App and configure
a Libretto Cloud API key:

- `LIBRETTO_API_KEY`

Libretto Cloud mints the short-lived GitHub installation token needed to read
contents, write contents, and open pull requests. For local development, you can
also pass `github.token`, set `LIBRETTO_GITHUB_TOKEN`, or set `GITHUB_TOKEN`.
