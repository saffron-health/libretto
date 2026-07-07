# @libretto/browser-tools

Browser tools for AI agents. Gives any agent framework a set of tools to open real browsers (local or cloud), inspect pages via accessibility snapshots, and drive them with Playwright code.

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { createBrowserTools } from "@libretto/browser-tools/ai-sdk";
import { LocalBrowserProvider } from "@libretto/browser-tools";

// Supports Libretto Cloud, Browserbase, Kernel, etc.
const { tools, dispose } = createBrowserTools(new LocalBrowserProvider());
// The agent can now call browser_open, browser_connect, browser_exec,
// browser_snapshot, browser_status, and browser_close.

const result = await generateText({
  model: anthropic("claude-sonnet-4-5"),
  tools,
  prompt: "Go to news.ycombinator.com and tell me the top story",
});

await dispose(); // close any sessions the agent left open
```

Under active development — not yet published.
