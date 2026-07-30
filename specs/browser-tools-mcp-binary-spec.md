# Browser Tools MCP binary

## Problem overview

Hosts such as Hermes and OpenClaw can load Browser Tools over MCP, but `libretto-browser-tools` only exports `registerMcpBrowserTools` for callers who own the server. Users cannot `npx` a ready MCP process.

## Solution overview

Ship a package `bin` that starts a stdio MCP server with the six browser tools and a local Chromium provider.

## Goals

- User runs `npx -y libretto-browser-tools` (or `… mcp`) and an MCP client can list and call the six tools.
- User can pass `--headed` / domain-policy flags without writing a custom server script.
- Docs show the npx install snippet for MCP clients.

## Non-goals

- OpenClaw native plugin (later phase).
- Hermes-specific packaging.
- Cloud browser providers in the CLI.
- HTTP / SSE MCP transport.

## Implementation plan

### Phase 1: MCP stdio binary

Add a CLI entry that creates `McpServer`, registers tools via existing `registerMcpBrowserTools`, connects `StdioServerTransport`, and disposes on shutdown.

```typescript
// packages/browser-tools/src/cli/index.ts
#!/usr/bin/env node
// parse argv → LocalBrowserProvider + domain options → registerMcpBrowserTools → stdio
```

- [x] `package.json` `bin`: `libretto-browser-tools` → `./dist/cli/index.js`
- [x] Move `@modelcontextprotocol/sdk` from optional peer to a runtime dependency so `npx` works.
- [x] Flags: `--headed`, `--allowed-domain` (repeatable), `--blocked-domain` (repeatable), `--help`
- [x] Accept optional `mcp` subcommand; bare invocation also starts the server (Playwright MCP-style).
- [x] Default headless.
- [x] Update `docs/browser-tools/adapters/mcp.mdx` with npx / Hermes / OpenClaw config snippets.
- [x] Tests: parse-args user-visible errors; spawn CLI over stdio and list tools / open+exec.

Success criteria:

- [x] `pnpm --filter libretto-browser-tools test` passes.
- [x] `pnpm --filter libretto-browser-tools type-check` passes.
- [x] Spawning the CLI with an MCP stdio client lists the six tool names.
