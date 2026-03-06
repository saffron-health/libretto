# libretto monorepo

## workspace packages

- `packages/libretto` - the core library package
- `packages/libretto-cli` - the CLI package

## development

```bash
pnpm install
pnpm build
pnpm type-check
pnpm --filter libretto-cli dev
```

## cli safety mode

`libretto-cli open` starts sessions in read-only mode by default. `exec` and `run` are blocked until the session is explicitly made interactive.

```bash
# default: read-only session (exec blocked)
libretto-cli open https://example.com

# user explicitly approves this session for actions
libretto-cli session-mode interactive --session default

# now action commands can run in that session
libretto-cli exec "return await page.url()" --session default
libretto-cli run ./integration.ts main --session default

# lock it back down afterward
libretto-cli session-mode read-only --session default
```

## AI configuration

Analysis commands use a shared AI runtime config file at `.libretto/config.json`.
There are two ways to configure it:

### Option 1: External coding agent (recommended)

Configure an external coding agent — no API keys needed in libretto, the agent handles its own authentication:

```bash
# Use one of: codex, claude, gemini
libretto-cli ai configure codex
libretto-cli ai configure claude
libretto-cli ai configure gemini

# Optionally provide a custom command prefix
libretto-cli ai configure codex -- my-custom-codex --flag

# Show current configuration
libretto-cli ai configure

# Clear configuration
libretto-cli ai configure --clear
```

### Option 2: Built-in LLM client via environment variables

If no external agent is configured, the CLI falls back to its built-in LLM client. This requires at least one of the following environment variables to be set:

- `GOOGLE_CLOUD_PROJECT` or `GCLOUD_PROJECT` — for Google/Gemini models
- `ANTHROPIC_API_KEY` — for Anthropic models
- `OPENAI_API_KEY` — for OpenAI models

If neither an external agent nor any of these environment variables are configured, analysis commands (including `snapshot`) will fail with an error.
