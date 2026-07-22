# libretto-browser-tools

Browser tools for AI agents. Gives any agent framework a set of tools to open real browsers (local or cloud), inspect pages via accessibility snapshots, and drive them with Playwright code.

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { createAiSdkBrowserTools } from "libretto-browser-tools/ai-sdk";
import { LocalBrowserProvider } from "libretto-browser-tools";

// Cloud providers (Libretto Cloud, Browserbase, Kernel, ...) are on the way.
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

## MCP

Install the optional MCP peer dependency when you use the MCP adapter:

```bash
npm install libretto-browser-tools @modelcontextprotocol/sdk
```

Register the tools on a caller-owned MCP server, then connect any transport:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LocalBrowserProvider } from "libretto-browser-tools";
import { registerMcpBrowserTools } from "libretto-browser-tools/mcp";

const server = new McpServer({
  name: "libretto-browser-tools",
  version: "1.0.0",
});
const { dispose } = registerMcpBrowserTools(
  server,
  new LocalBrowserProvider({ headless: true }),
);

await server.connect(new StdioServerTransport());

process.once("SIGTERM", async () => {
  await dispose();
  await server.close();
});
```

Use one toolkit per user or connection when browser sessions must stay
isolated. The host owns authentication, transport, and shutdown.
