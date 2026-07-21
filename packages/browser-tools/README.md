# libretto-browser-tools

Browser tools for AI agents. Gives any agent framework a set of tools to open real browsers (local or cloud), inspect pages via accessibility snapshots, and drive them with Playwright code.

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

## Install

```bash
npm i libretto-browser-tools
npx playwright install chromium
```

For the AI SDK adapter, also install `ai` and a model provider package.

## Docs

- Product page: https://libretto.sh/browser-tools
- Quickstart: https://libretto.sh/docs/browser-tools/quickstart
- Adapters: [AI SDK](https://libretto.sh/docs/browser-tools/adapters/ai-sdk), [Pi](https://libretto.sh/docs/browser-tools/adapters/pi), [Custom](https://libretto.sh/docs/browser-tools/adapters/custom)
- Providers: https://libretto.sh/docs/browser-tools/providers/overview

## License

MIT
