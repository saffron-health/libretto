---
name: libretto
description: "Browser automation CLI for building, maintaining, and running browser automation workflows by inspecting live pages and prototyping interactions."
license: MIT
metadata:
  author: saffron-health
  version: "0.4.2"
---

## How Libretto Works

- Libretto is a CLI for exploring live websites and building or debugging reusable browser automation scripts.
- Use Libretto commands to inspect the site and open pages, observe state, query session logs with `jq`, and prototype interactions.
- Libretto work must end in script changes. Create or edit the workflow file instead of stopping at interactive exploration.

## Default Integration Approach

- Prefer network requests first for new integrations unless the user explicitly asks for Playwright or UI automation, then do not use the site's internal API.
- Read `references/site-security-review.md` before committing to a network-first approach on a new site.
- Fall back to passive interception or Playwright-driven UI automation when the security review rules network requests out, the request path is not workable, or the user explicitly asks for Playwright.

## Setup

- Use `npx libretto init` for first-time workspace setup (sets up config file and snapshot command).
- If credentials are already available, `npx libretto ai configure openai|anthropic|gemini|vertex` is usually enough.

## Working Rules

- Announce which session you are using and what page you are on.
- Ask instead of guessing when it is unclear what to click, type, or submit.
- Defer repo/code review until you begin generating code, unless the user explicitly asks for it earlier.
- Read and follow guidelines in `references/code-generation-rules.md` before generating or editing production workflow code.
- Validation requires a successful clean `run --headless` with confirmation of the actual returned output, not just process success. If the user wants to watch the finished workflow, do a final headed `run` after headless validation succeeds.
- Keep Libretto sessions tidy: close unneeded sessions when you are done with them and before starting new ones, unless the user explicitly wants a session kept open.
- Get explicit user confirmation before mutating actions or replaying network requests that may have side effects.
- Never run multiple `exec` commands at the same time.

## Commands

### `open`

- Open a page before using `exec` or `snapshot`.
- Use `open` at the start of script authoring when you need live page state to decide how the workflow should work.
- Use headed mode when the user needs to log in or watch the workflow.

```bash
npx libretto open https://example.com --headed
npx libretto open https://example.com --headless --session debug-example
```

### `snapshot`

- Use `snapshot` as the primary page observation tool.
- Always provide both `--objective` and `--context`.
- Use it before guessing at selectors, after workflow failures, and whenever the visible page state is unclear.
- When analysis is involved, expect it to take time. Use a timeout of at least 2 minutes for shell-wrapped calls.

```bash
npx libretto snapshot \
  --objective "Find the sign-in form and submit button" \
  --context "I just opened the login page and need the email field, password field, and submit button."
npx libretto snapshot \
  --session debug-example \
  --page <page-id> \
  --objective "Explain why the table is empty" \
  --context "I opened the referrals page, applied filters, and expected rows to appear."
```

### `exec`

- Use `exec` for focused inspection and short-lived interaction experiments.
- Use `exec` to validate selectors, inspect data, or prototype a step before you encode it in the workflow file.
- Let failures throw. Do not hide `exec` failures with `try/catch` or `.catch()`.
- Do not run multiple `exec` commands in parallel.

```bash
npx libretto exec "return await page.url()"
npx libretto exec "return await page.locator('button').count()"
npx libretto exec --visualize "await page.locator('button:has-text(\"Continue\")').click()"
```

### `pages`

- Use `pages` when a popup, new tab, or second page appears.
- If `exec` or `snapshot` complains about multiple pages, list page ids first and then pass `--page`.

```bash
npx libretto pages --session debug-example
npx libretto exec --session debug-example --page <page-id> "return await page.url()"
```

### `run`

- Use `run` to verify a workflow file after creating it or editing it, preferring `run --headless` for the normal fix/verify loop.
- Plain `run` defaults to headed mode.
- If the workflow fails, Libretto keeps the browser open. Inspect the failed state with `snapshot` and `exec` before editing code.
- Insert `await pause(session)` statements in the workflow file when you need to stop at specific states for interactive debugging, like breakpoints in the browser flow.
- If the workflow pauses, resume it with `npx libretto resume --session <name>`.
- Re-run the same workflow after each fix to verify the browser behavior end to end.

```bash
npx libretto run ./integration.ts main --headless --params '{"status":"open"}'
npx libretto run ./integration.ts main --auth-profile app.example.com
```

### `resume`

- Workflows pause by calling `await pause()` in the workflow file.
- Use `resume` when a workflow hit `await pause()`.
- Keep resuming the same session until the workflow completes or pauses again.

```bash
npx libretto resume --session debug-example
```

### `save`

- Use `save` only when the user explicitly asks to save or reuse authenticated browser state.

```bash
npx libretto save app.example.com
```

### `close`

- Use `close` when the user is done with the session or an exploration session is no longer helping progress (unless the user asked to keep watching that browser).
- `close --all` is available for workspace cleanup.

```bash
npx libretto close --session debug-example
npx libretto close --all
```

## Logs

Session logs are JSONL files at `.libretto/sessions/<session>/`. Use `jq` to query them directly — for any filtering, slicing, or inspection task.
There are no dedicated `network` or `actions` CLI commands.

```bash
# Last 20 action entries
tail -n 20 .libretto/sessions/<session>/actions.jsonl | jq .

# POST requests only
jq 'select(.method == "POST")' .libretto/sessions/<session>/network.jsonl
```

### Action log (`actions.jsonl`)

Key fields: `ts` (ISO timestamp), `source` (`user` or `agent`), `action` (`click`, `fill`, `goto`, etc.), `selector` (locator used by the agent), `bestSemanticSelector` (canonical selector for user DOM events), `success` (boolean), `url` (navigation target), `value` (typed or submitted value), `error` (message on failure).

Read `references/action-logs.md` for full field descriptions and user-vs-agent entry semantics.

### Network log (`network.jsonl`)

Key fields: `ts` (ISO timestamp), `method` (HTTP method, e.g. `GET`, `POST`), `url` (request URL), `status` (HTTP status code), `contentType` (response content type), `responseBody` (response body string, may be null).

## References

- Read `references/configuration-file-reference.md` when you need to inspect or change `.libretto/config.json` for snapshot model selection or viewport defaults.
- Read `references/site-security-review.md` before reviewing the site's security posture and deciding whether to lead with network requests, passive interception, or Playwright DOM automation on a new site.
- Read `references/code-generation-rules.md` before writing or editing production workflow files.
- Read `references/auth-profiles.md` when auth-profile behavior is relevant.
- Read `references/pages-and-page-targeting.md` when a session has multiple open pages or you need `--page`.
- Read `references/action-logs.md` for full action log field descriptions and user-vs-agent event semantics.
