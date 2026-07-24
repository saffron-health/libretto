<div align="center">
  <a href="https://libretto.sh/browser-tools">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../../apps/website/public/logos/logo-dark.svg" alt="Libretto">
      <img src="../../apps/website/public/logos/logo-light.svg" alt="Libretto" height="72">
    </picture>
  </a>
  <br/>
  <br/>
  <h3>Browser Tools SDK gives any AI agent a real browser.</h3>
  <p>Six tools to open, inspect, and drive browsers from AI SDK, Pi, or your own agent loop.</p>
  <p>
    <a href="https://libretto.sh/docs/browser-tools/quickstart">Quickstart</a> •
    <a href="https://libretto.sh/docs/browser-tools/quickstart">Documentation</a> •
    <a href="https://libretto.sh/browser-tools">Product</a> •
    <a href="https://www.npmjs.com/package/libretto-browser-tools">npm</a> •
    <a href="https://discord.gg/NYrG56hVDt">Discord</a>
  </p>
</div>

## Install

```bash
npm i libretto-browser-tools
npx playwright install chromium
```

For the AI SDK adapter, also install `ai` and a model provider package.

## Example

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { createAiSdkBrowserTools } from "libretto-browser-tools/ai-sdk";
import { LocalBrowserProvider } from "libretto-browser-tools";
// Or a cloud provider:
// import { LibrettoCloudBrowserProvider } from "libretto-browser-tools/libretto-cloud";
// import { BrowserbaseBrowserProvider } from "libretto-browser-tools/browserbase";
// import { KernelBrowserProvider } from "libretto-browser-tools/kernel";

const { tools, dispose } = createAiSdkBrowserTools(new LocalBrowserProvider());
// The agent can now call browser_open, browser_connect, browser_exec,
// browser_snapshot, browser_status, and browser_close.

const result = await generateText({
  model: anthropic("claude-sonnet-4-5"),
  tools,
  prompt: "Go to news.ycombinator.com and tell me the top story",
});

await dispose(); // close any sessions the agent left open
```

## Auth profiles

Auth profiles preserve signed-in browser state across sessions, so agents can reuse an account without signing in each time.

```typescript
import { createBrowserTools, LocalBrowserProvider } from "libretto-browser-tools";

const toolkit = createBrowserTools(new LocalBrowserProvider());
await toolkit.tools.browser_open.execute({ authProfile: "work" });
```

On supported providers, omitting `authProfile` uses the named `default` profile. Pass `authProfile: false` for incognito.

| Provider | Named auth profiles |
| --- | --- |
| Local | Supported |
| Libretto Cloud | Supported |
| Kernel | Supported |
| Browser Use | Supported |
| Browserbase | Unsupported |
| Steel | Unsupported |

Browserbase and Steel expose provider IDs but not durable names. Libretto needs a durable name-to-ID mapping before they can support named profiles.

Profiles contain signed-in browser state. Do not commit profile data. Changes persist only after `browser_close` or graceful `dispose()`. Do not open concurrent writable sessions against the same profile.

## Docs

- Product page: https://libretto.sh/browser-tools
- Quickstart: https://libretto.sh/docs/browser-tools/quickstart
- Adapters: [AI SDK](https://libretto.sh/docs/browser-tools/adapters/ai-sdk), [Pi](https://libretto.sh/docs/browser-tools/adapters/pi), [Custom](https://libretto.sh/docs/browser-tools/adapters/custom)
- Providers: https://libretto.sh/docs/browser-tools/providers/overview

## License

MIT
