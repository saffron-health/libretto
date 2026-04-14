---
name: libretto
description: "Browser automation CLI for building, maintaining, and running browser automation workflows by inspecting live pages and prototyping interactions."
license: MIT
metadata:
  author: saffron-health
  version: "0.6.6"
---

## How Libretto Works

- Libretto is a CLI for exploring live websites and building or debugging reusable browser automation scripts.
- Use Libretto commands to inspect the site and open pages, observe state, inspect requests, and prototype interactions.
- Libretto work must end in script changes. Create or edit the workflow file instead of stopping at interactive exploration.

## Default Integration Approach

- Prefer network requests first for new integrations unless the user explicitly asks for Playwright or UI automation, then do not use the site's internal API.
- Read `references/site-security-review.md` before committing to a network-first approach on a new site.
- Fall back to passive interception or Playwright-driven UI automation when the security review rules network requests out, the request path is not workable, or the user explicitly asks for Playwright.

## Setup

- Use `npx libretto setup` for first-time workspace onboarding. It installs Chromium, syncs skills, and pins the default snapshot model to `.libretto/config.json` when provider credentials are available.
- Re-running `setup` on a healthy workspace shows the current configuration. If credentials are missing for a configured provider, it offers an interactive repair flow.
- Use `npx libretto status` to inspect AI configuration health and open sessions without triggering setup.
- Use `npx libretto ai configure openai|anthropic|gemini|vertex` to explicitly change the snapshot model or provider (advanced override).

## Working Rules

- Announce which session you are using and what page you are on.
- Ask instead of guessing when it is unclear what to click, type, or submit.
- Do not treat visibility as interactivity. If an element will not act, inspect blockers before retrying.
- Defer repo/code review until you begin generating code, unless the user explicitly asks for it earlier.
- Read and follow guidelines in `references/code-generation-rules.md` before generating or editing production workflow code.
- Validation requires a successful clean `run --headless` with confirmation of the actual returned output, not just process success. If the user wants to watch the finished workflow, do a final headed `run` after headless validation succeeds.
- Treat exploration sessions as disposable unless the user explicitly wants one kept open.
- Get explicit user confirmation before mutating actions or replaying network requests that may have side effects.
- Never run multiple `exec` commands at the same time.
- If the browser must remain read-only, switch to the `libretto-readonly` skill and use `readonly-exec` instead of `exec`.

## Commands

### `open`

- Open a page before using `exec` or `snapshot`.
- Use `open` at the start of script authoring when you need live page state to decide how the workflow should work.
- Use headed mode when the user needs to log in or watch the workflow.
- Pass `--read-only` when you want the session locked for inspection from the moment it is created.

```bash
npx libretto open https://example.com --headed
npx libretto open https://example.com --headless --read-only --session readonly-example
npx libretto open https://example.com --headless --session debug-example
```

### `connect`

- Use `connect` to attach to any existing Chrome DevTools Protocol (CDP) endpoint — a browser started with `--remote-debugging-port`, an Electron app, or any other CDP-compatible target.
- After connecting, `exec`, `snapshot`, `pages`, and the rest of the session commands follow that session's stored mode.
- Libretto does not manage the connected process's lifecycle. `close` clears the session but does not terminate the remote process.
- Pass `--read-only` if the connected session must stay inspection-only from the start.

```bash
npx libretto connect http://127.0.0.1:9222 --session my-session
npx libretto connect http://127.0.0.1:9222 --read-only --session readonly-session
npx libretto connect http://127.0.0.1:9223 --session another-session
```

### `session-mode`

- Use `session-mode` to inspect whether an existing session is `write-access` or `read-only`.
- Only a user can change the session mode for an existing session. Never change a session's mode on your own — the user must change it themselves manually.
- `open`, `run`, and `connect` default new sessions to `write-access` unless the config sets `sessionMode` to `read-only`.
- Pass `--read-only` or `--write-access` to override the config default for a single command.

```bash
npx libretto session-mode --session my-session
```

### `snapshot`

- Use `snapshot` as the primary page observation tool.
- Always provide both `--objective` and `--context`.
- A single snapshot objective can include multiple questions or analysis tasks.
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
- Use `exec -` to run multi-line scripts from stdin, especially when the code is too long or complex for a command line argument.
- Available globals: `page`, `context`, `browser`, `state`, `fetch`, `Buffer`.
- Let failures throw. Do not hide `exec` failures with `try/catch` or `.catch()`.
- Do not run multiple `exec` commands in parallel.
- Do not use `exec` in read-only diagnosis flows. Use `readonly-exec` from the `libretto-readonly` skill for those sessions.

```bash
npx libretto exec "return await page.url()"
npx libretto exec "return await page.locator('button').count()"
npx libretto exec "await page.locator('button:has-text(\"Continue\")').click()"
echo "return await page.url()" | npx libretto exec - --session debug-example
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
- Pass `--read-only` if the preserved session should come back locked for follow-up terminal inspection after the workflow run.
- If the workflow fails, Libretto keeps the browser open. Inspect the failed state with `snapshot` and `exec` before editing code.
- Insert `await pause(session)` statements in the workflow file when you need to stop at specific states for interactive debugging, like breakpoints in the browser flow.
- If the workflow pauses, resume it with `npx libretto resume --session <name>`.
- Re-run the same workflow after each fix to verify the browser behavior end to end.

```bash
npx libretto run ./integration.ts --headless --params '{"status":"open"}'
npx libretto run ./integration.ts --headless --read-only
npx libretto run ./integration.ts --auth-profile app.example.com
```

### `resume`

- Workflows pause by calling `await pause("session-name")` in the workflow file. Import `pause` from `"libretto"`.
- `pause(session)` is a no-op when `NODE_ENV === "production"`.
- Use `resume` when a workflow hit a `pause()` call.
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

## Session Logs

Session state is stored in `.libretto/sessions/<session>/state.json`.

Session logs are JSONL files at `.libretto/sessions/<session>/`:

- CLI logs are in `.libretto/sessions/<session>/logs.jsonl`.
- Action logs are in `.libretto/sessions/<session>/actions.jsonl`.
- Network logs are in `.libretto/sessions/<session>/network.jsonl`.

Use `jq` to query jsonl logs directly — for any filtering, slicing, or inspection task.

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

## Examples

### Building new browser automation workflows

#### Interactive building

```text
<example>
[Context: The user wants to build a new browser workflow and does not yet know the page structure]
Assistant: I'll inspect the real site first if needed, but before I finish I'll create `target-workflow.ts` so the task produces reusable automation code.
Assistant: [Runs `npx libretto open https://target.example.com --headed`]
Assistant: [Reads `references/site-security-review.md` before choosing between passive network inspection, direct browser fetch calls, and Playwright-first automation]
Assistant: [Runs `npx libretto snapshot --objective "Find the next required action" --context "We are starting the workflow from the landing page and need the first meaningful step."`]
Assistant: [Uses `snapshot` and `exec` as needed to understand the site and decide the implementation path]
Assistant: [Reads `references/code-generation-rules.md` before writing production workflow code]
Assistant: I found the working path. I'll now update the workflow file outside Libretto and verify it with `npx libretto run ...`.
</example>
```

### Debugging existing workflows

```text
<example>
[Context: The user has an existing Libretto workflow that is failing]
Assistant: I'll reproduce the failure first so we can inspect the exact browser state it leaves behind.
Assistant: [Runs `npx libretto run ./integration.ts --session debug-flow --headed`]
Assistant: The workflow failed and Libretto kept the browser open. I'll inspect the page state before changing code.
Assistant: [Runs `npx libretto snapshot --session debug-flow --objective "Find the blocking error or broken selector target" --context "The workflow just failed after trying to continue from the review step, and I need to identify the visible blocker on the current page."`]
Assistant: [Runs `npx libretto exec --session debug-flow "...focused inspection or prototype..."`]
Assistant: [Reads `references/code-generation-rules.md` before patching the workflow file]
Assistant: I found the issue. I'll patch the workflow code, then rerun `npx libretto run ...` to verify the fix.
</example>
```

## References

- Read `references/configuration-file-reference.md` when you need to inspect or change `.libretto/config.json` for snapshot model selection or viewport defaults.
- Read `references/site-security-review.md` before reviewing the site's security posture and deciding whether to lead with network requests, passive interception, or Playwright DOM automation on a new site.
- Read `references/code-generation-rules.md` before writing or editing production workflow files.
- Read `references/auth-profiles.md` when auth-profile behavior is relevant.
- Read `references/pages-and-page-targeting.md` when a session has multiple open pages or you need `--page`.
- Read `references/action-logs.md` for full action log field descriptions and user-vs-agent event semantics.
