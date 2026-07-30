# Browser Tools for Hermes / OpenClaw — research

## Verdict

Hermes and OpenClaw are separate agent harnesses that both already browse the web. An integration is not one adapter. It is two products that share Libretto Cloud session creation and optionally the Browser Tools six-tool surface.

The strongest launch pattern on Hermes is already proven by Steel: a standalone browser-provider plugin that only creates and closes CDP sessions under Hermes' native `browser_*` tools. The strongest launch pattern on OpenClaw is a TypeScript plugin (and/or MCP server) because OpenClaw is TypeScript-native and already has a full browser control stack.

"Browser Tools for Hermes/OpenClaw" can mean either (1) Libretto Cloud as the browser backend under each host's native tools, or (2) Libretto's six tools (`browser_open` / `exec` / `snapshot` / …) as a first-class toolkit beside or instead of those hosts' browsers. Those are different launches.

## What these projects are

### Hermes Agent (Nous Research)

- Python personal agent with memory, skills, messaging gateways, and a plugin system.
- Not a fork of OpenClaw. Hermes can import an OpenClaw setup via `hermes claw migrate`.
- Docs: https://hermes-agent.nousresearch.com/docs
- Repo: https://github.com/NousResearch/hermes-agent

Native browser path: Hermes owns browsing (`agent-browser` + `tools/browser_tool.py`). Cloud backends only supply session lifecycle: create remote browser → return CDP WebSocket URL → close session.

### OpenClaw

- TypeScript self-hosted gateway that connects chat channels (Telegram, Discord, Slack, …) to an agent with tools, skills, plugins, and a Control UI.
- Docs: https://docs.openclaw.ai
- Ships a bundled `browser` plugin: managed Chromium profile, Chrome extension relay for signed-in tabs, Chrome MCP "user" profile, and remote CDP attach.

### Not the same as "Hermes Browser Extension"

`abundantbeing/hermes-browser-extension` is a Chromium side panel that talks to a Hermes API server. It feeds page context into Hermes; it does not replace Hermes browser automation. Do not confuse it with a Libretto integration target.

## What Browser Tools SDK already is

Package: `libretto-browser-tools` (`packages/browser-tools`).

- Core: six framework-neutral tools — `browser_open`, `browser_connect`, `browser_exec`, `browser_snapshot`, `browser_status`, `browser_close`.
- Contract: every provider reduces to "produce a CDP endpoint"; Playwright attaches.
- Providers: local, Libretto Cloud, Kernel, Browser Use, Browserbase, Steel.
- Adapters today: AI SDK, Pi, MCP (`registerMcpBrowserTools` on a caller-owned server).
- Gap: no packaged stdio MCP binary, no Hermes plugin, no OpenClaw plugin.

Libretto Cloud already returns `cdp_url` and optional `live_view_url` — the same shape Hermes browser providers and OpenClaw remote CDP profiles need.

## Extension points

### Hermes

| Surface | Fit for Libretto | Notes |
| --- | --- | --- |
| Browser Provider Plugin | Best for cloud sessions | Official ABC: `create_session` → `{session_name, bb_session_id, cdp_url, features}`, `close_session`, `emergency_cleanup`, `get_setup_schema`. Select with `browser.cloud_provider`. |
| MCP client | Best for six-tool SDK | Config `mcp_servers` in `~/.hermes/config.yaml`; tools appear as `mcp_<server>_<tool>`. |
| General Python plugin (`ctx.register_tool`) | Possible but redundant | Reimplements tools Hermes already has, or duplicates MCP. |
| Skill (`SKILL.md`) | Complementary | Teach when to use Libretto / live view / auth profiles; does not create sessions. |
| Pip entry point / `~/.hermes/plugins/` / Claw-style install | Distribution | Steel ships as `hermes plugins install steel-dev/hermes-steel --enable`. Vendor plugins stay out of Hermes core. |

Reference: [Browser Provider Plugins](https://hermes-agent.nousresearch.com/docs/developer-guide/browser-provider-plugin), [Steel Hermes plugin](https://github.com/steel-dev/hermes-steel), [Steel launch post](https://steel.dev/blog/hermes-steel-plugin).

### OpenClaw

| Surface | Fit for Libretto | Notes |
| --- | --- | --- |
| Native plugin (`api.registerTool`) | Best for six-tool SDK | TypeScript ESM, `openclaw.plugin.json`, ClawHub publish. Same shape as Pi adapter. |
| MCP client (`openclaw mcp add`) | Fastest path | Reuses existing MCP adapter once a stdio (or HTTP) entry exists. |
| Bundled `browser` plugin replace | Heavy | Docs allow disabling `browser` and registering the same tool name. OpenClaw's browser is a control service + CLI + profiles + extension, not a thin CDP factory. |
| Remote CDP profile (`cdpUrl` + `attachOnly`) | Partial | OpenClaw can attach to a fixed remote CDP URL. It does not create/destroy Libretto Cloud sessions per task unless something else does. |
| Chrome extension / user profiles | Out of scope for v1 | OpenClaw's signed-in-tab story; Libretto auth profiles are a different persistence model. |
| Skill / ClawHub package | Complementary | Operating guidance once tools or cloud backend exist. |

Reference: [Building plugins](https://docs.openclaw.ai/plugins/building-plugins), [Browser](https://docs.openclaw.ai/tools/browser), [MCP CLI](https://docs.openclaw.ai/cli/mcp).

## Two integration products (do not collapse them)

### A. Libretto Cloud as browser backend ("sessions under their tools")

Hermes keeps `browser_navigate` / `browser_click` / …  
OpenClaw keeps its single `browser` tool and profiles.

Libretto only creates cloud Chromium sessions and returns CDP (+ live view).

Pros:

- Matches Hermes' official vendor path (Steel already shipped this).
- No second browser tool vocabulary for the agent to learn.
- Live view is a clear demo moment ("watch the agent browse").

Cons:

- Does not showcase Browser Tools SDK (exec + snapshot loop).
- OpenClaw has no first-class "browser provider plugin" ABC; session create/close must live in a custom plugin, MCP helper, or gateway hook that keeps `cdpUrl` fresh.

### B. Browser Tools six-tool surface ("our tools in their agent")

Register Libretto's six tools via MCP and/or native OpenClaw plugin (and optionally Hermes `register_tool`).

Pros:

- Direct product line for Browser Tools SDK.
- Playwright `browser_exec` is a differentiator vs click/ref stacks.
- One MCP binary can serve Hermes, OpenClaw, Cursor, and others.

Cons:

- Overlaps native browser tools; agents may thrash between two stacks unless skill/docs say which to use.
- On Hermes, fighting the recommended provider plugin pattern.
- Needs a packaged MCP entrypoint (docs show a snippet; package has no `bin` yet).

### Recommended launch shape

Ship both, named clearly:

1. **Libretto for Hermes** — Python browser-provider plugin for Libretto Cloud (Steel-shaped install UX).
2. **Browser Tools for OpenClaw** — TypeScript plugin wrapping `createBrowserTools` + Libretto Cloud (and local) providers; optional MCP twin for users who prefer config-only MCP.
3. **Shared MCP stdio binary** — `libretto-browser-tools-mcp` (or `npx libretto-browser-tools mcp`) so Hermes/OpenClaw/anyone can attach without a native plugin.

Marketing can still say "Browser Tools for Hermes/OpenClaw" if the MCP path is the shared story and the Hermes provider is positioned as "Libretto Cloud powering Hermes browser."

## Concrete integration sketches

### Hermes browser provider (v1 candidate)

Standalone repo (Hermes policy: vendor backends are not merged into core), e.g. `libretto/hermes-libretto` or under this monorepo as `packages/hermes-libretto`.

```text
plugins/browser/libretto/   # or top-level plugin package
  plugin.yaml               # kind: backend, provides_browser_providers: [libretto]
  __init__.py               # register(ctx) -> ctx.register_browser_provider(...)
  provider.py               # BrowserProvider ABC
```

`create_session(task_id)`:

1. Call Libretto Cloud session create (same API as `LibrettoCloudBrowserProvider`).
2. Poll until `cdp_url` exists.
3. Return Hermes contract with `bb_session_id` = Libretto session id, `cdp_url`, `features`, optional live view via result hook.

User path (mirror Steel):

```bash
hermes plugins install <org>/hermes-libretto --enable
hermes config set browser.cloud_provider libretto
# installer prompts for LIBRETTO_API_KEY into ~/.hermes/.env
```

Must implement `get_setup_schema()` so `hermes tools` can configure the backend. Steel's lesson: never auto-select the cloud provider; require an explicit `cloud_provider` set.

Auth profiles: Hermes' provider ABC is session create/close only. Map Libretto `authProfile` through config/env (e.g. `browser.libretto.auth_profile`) rather than inventing Hermes tool params in v1.

### OpenClaw plugin (v1 candidate)

Package e.g. `@libretto/openclaw-browser-tools`:

- `openclaw.plugin.json` with `contracts.tools` listing the six tool names.
- `definePluginEntry` + `api.registerTool` for each tool from `createBrowserTools(provider)`.
- Config schema: provider (`libretto-cloud` | `local`), API key env, optional `allowedDomains`, default `authProfile`.
- Dispose toolkit on plugin unload / gateway stop.
- Publish to ClawHub; install with `openclaw plugins install clawhub:…`.

Optional: register tools as optional so users opt in via `tools.allow` and keep OpenClaw's bundled `browser` for signed-in Chrome.

### Shared MCP binary (unblocks both without native plugins)

Add a small CLI entry that owns `McpServer` + `StdioServerTransport` and calls existing `registerMcpBrowserTools`.

Hermes:

```yaml
mcp_servers:
  libretto:
    command: npx
    args: ["-y", "libretto-browser-tools", "mcp"]
    # or a dedicated bin package
```

OpenClaw:

```bash
openclaw mcp add libretto -- npx -y libretto-browser-tools mcp
```

This is the lowest-code path to "Browser Tools" branding on both hosts.

## Competitive / ecosystem notes

- Steel already owns the Hermes "cloud browser plugin" narrative (Jul 2026). Libretto should match install UX and live-view storytelling, then differentiate on auth profiles, Browser Tools exec model (via MCP/OpenClaw), and Libretto Cloud product.
- Hermes also bundles Browserbase / Browser Use / Firecrawl as in-tree browser backends. Libretto Cloud competes in that picker.
- OpenClaw's chrome extension and `user` profile solve signed-in personal browsing. Libretto should not try to replace that in v1; offer cloud/local agent browsers and auth profiles instead.
- Skills are portable-ish (AgentSkills). A short Libretto skill that teaches open → snapshot → exec → close helps MCP users on both hosts.

## Suggested goals / non-goals (for a later implementation spec)

Goals:

- Hermes user can select Libretto Cloud as `browser.cloud_provider` and run native Hermes browser tools against a Libretto session with live view.
- OpenClaw user can install a plugin or MCP server and call Libretto's six tools.
- One documented quickstart page covers both hosts.

Non-goals (v1):

- Replacing OpenClaw's Chrome extension / tab-copilot path.
- Merging code into Hermes or OpenClaw core.
- Shipping a Chromium side-panel competing with hermes-browser-extension.
- Unifying Hermes' click/ref tool schema with Libretto's exec schema into one agent-facing API.

## Open product choices

1. Lead with cloud-provider (A), six-tool SDK (B), or both under one brand?
2. Hermes package location: separate GitHub repo (Steel-style) vs monorepo package?
3. OpenClaw: register six tools beside bundled `browser`, or attempt to replace `browser`?
4. Is Libretto Cloud required for the launch, or is local Chromium enough for OpenClaw/MCP demos?
5. Auth profiles in Hermes v1 via config only, or wait until the provider ABC grows?

## Sources

- Hermes plugins map: https://hermes-agent.nousresearch.com/docs/developer-guide/plugins
- Hermes browser providers: https://hermes-agent.nousresearch.com/docs/developer-guide/browser-provider-plugin
- Hermes MCP: https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp
- Steel Hermes plugin + blog: https://github.com/steel-dev/hermes-steel , https://steel.dev/blog/hermes-steel-plugin
- OpenClaw tools / browser / plugins / MCP: https://docs.openclaw.ai/tools , https://docs.openclaw.ai/tools/browser , https://docs.openclaw.ai/plugins/building-plugins , https://docs.openclaw.ai/cli/mcp
- OpenClaw Chrome extension: https://docs.openclaw.ai/tools/chrome-extension
- This repo: `packages/browser-tools/`, `docs/browser-tools/adapters/mcp.mdx`
