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
<<<<<<< HEAD
- Use Libretto commands to inspect the site and open pages, observe state, query session logs with `jq`, and prototype interactions.
=======
- Use Libretto to inspect the real site first: open pages, observe state, inspect requests, and prototype interactions before writing code.
>>>>>>> origin/main
- Libretto work must end in script changes. Create or edit the workflow file instead of stopping at interactive exploration.

## Default Integration Approach

<<<<<<< HEAD
- Prefer network requests first for new integrations unless the user explicitly asks for Playwright or UI automation, then do not use the site's internal API.
=======
- Prefer network requests first for new integrations.
>>>>>>> origin/main
- Read `references/site-security-review.md` before committing to a network-first approach on a new site.
- Fall back to passive interception or Playwright-driven UI automation when the security review rules network requests out, the request path is not workable, or the user explicitly asks for Playwright.

## Setup

<<<<<<< HEAD
- Use `npx libretto init` for first-time workspace setup (sets up config file and snapshot command).
=======
- Ask the user to set up snapshot analysis before relying on `snapshot` for page understanding.
- Use `npx libretto init` for first-time workspace setup.
>>>>>>> origin/main
- If credentials are already available, `npx libretto ai configure openai|anthropic|gemini|vertex` is usually enough.

## Working Rules

- Announce which session you are using and what page you are on.
- Ask instead of guessing when it is unclear what to click, type, or submit.
<<<<<<< HEAD
- Defer repo/code review until you begin generating code, unless the user explicitly asks for it earlier.
- Read and follow guidelines in `references/code-generation-rules.md` before generating or editing production workflow code.
- Validation requires a successful clean `run --headless` with confirmation of the actual returned output, not just process success. If the user wants to watch the finished workflow, do a final headed `run` after headless validation succeeds.
- Treat exploration sessions as disposable unless the user explicitly wants one kept open.
- Get explicit user confirmation before mutating actions or replaying network requests that may have side effects.
- Never run multiple `exec` commands at the same time.
=======
- Read and follow guidelines in `references/code-generation-rules.md` before generating or editing production workflow code.
- After interactive exploration and code generation, test key logic with `exec`, then verify the workflow file with `run --headless`.
- Get explicit user confirmation before mutating actions or replaying network requests that may have side effects.
- Never run multiple `exec` commands at the same time.
- Keep the browser session open until the user says the session is done.

## Session Storage

- Session state is stored in `.libretto/sessions/<session>/state.json`.
- CLI logs are stored in `.libretto/sessions/<session>/logs.jsonl`.
>>>>>>> origin/main

## Commands

### `open`

- Open a page before using `exec` or `snapshot`.
- Use `open` at the start of script authoring when you need live page state to decide how the workflow should work.
- Use headed mode when the user needs to log in or watch the workflow.

```bash
npx libretto open https://example.com --headed
npx libretto open https://example.com --headless --session debug-example
```

<<<<<<< HEAD
=======
### `connect`

- Use `connect` to attach to any existing Chrome DevTools Protocol (CDP) endpoint — a browser started with `--remote-debugging-port`, an Electron app, or any other CDP-compatible target.
- After connecting, `exec`, `snapshot`, `pages`, and all other session commands work normally.
- Libretto does not manage the connected process's lifecycle. `close` clears the session but does not terminate the remote process.

```bash
npx libretto connect http://127.0.0.1:9222 --session my-session
npx libretto connect http://127.0.0.1:9223 --session another-session
```

>>>>>>> origin/main
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
<<<<<<< HEAD
=======
- Available globals: `page`, `context`, `browser`, `state`, `networkLog(opts?)`, `actionLog(opts?)`, `fetch`, `Buffer`.
>>>>>>> origin/main
- Let failures throw. Do not hide `exec` failures with `try/catch` or `.catch()`.
- Do not run multiple `exec` commands in parallel.

```bash
npx libretto exec "return await page.url()"
npx libretto exec "return await page.locator('button').count()"
<<<<<<< HEAD
npx libretto exec --visualize "await page.locator('button:has-text(\"Continue\")').click()"
=======
npx libretto exec "await page.locator('button:has-text(\"Continue\")').click()"
>>>>>>> origin/main
```

### `pages`

- Use `pages` when a popup, new tab, or second page appears.
<<<<<<< HEAD
- If `exec` or `snapshot` complains about multiple pages, list page ids first and then pass `--page`.
=======
- If `exec`, `snapshot`, `network`, or `actions` complains about multiple pages, list page ids first and then pass `--page`.
>>>>>>> origin/main

```bash
npx libretto pages --session debug-example
npx libretto exec --session debug-example --page <page-id> "return await page.url()"
```

<<<<<<< HEAD
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
=======
### `network`

- Use `network` to inspect the requests the page already made.
- Prefer this when discovering how a site loads data or when validating whether a network-first approach is workable.
- Filter aggressively by method, URL pattern, and page when the log is noisy.
- Use `--clear` to reset the network log before reproducing an issue.

```bash
npx libretto network --session debug-example --last 20
npx libretto network --session debug-example --method POST --filter 'referral|patient'
npx libretto network --session debug-example --page <page-id>
npx libretto network --session debug-example --clear
```

### `actions`

- Use `actions` when you need a quick record of recent user or agent interactions in the current session.
- Keep it lightweight. It is a helper for orientation, not the main integration-building workflow.
- Use `--clear` to reset the action log before reproducing an issue.

```bash
npx libretto actions --session debug-example --last 20
npx libretto actions --session debug-example --action click --source user
npx libretto actions --session debug-example --clear
```

### `run`

- Use `run` to verify a workflow file after creating it or editing it.
- If the workflow fails, Libretto keeps the browser open. Inspect the failed state with `snapshot` and `exec` before editing code.
- If the workflow pauses, resume it with `npx libretto resume --session <name>`.
- Re-run the same workflow after each fix to verify the browser behavior end to end.
- By default in headed mode, a ghost cursor and element highlights are shown. Use `--no-visualize` to disable.

```bash
npx libretto run ./integration.ts main
npx libretto run ./integration.ts main --params '{"status":"open"}'
npx libretto run ./integration.ts main --auth-profile app.example.com --headed
>>>>>>> origin/main
```

### `resume`

<<<<<<< HEAD
- Workflows pause by calling `await pause()` in the workflow file.
- Use `resume` when a workflow hit `await pause()`.
=======
- Workflows pause by calling `await pause("session-name")` in the workflow file. Import `pause` from `"libretto"`.
- `pause(session)` is a no-op when `NODE_ENV === "production"`.
- Use `resume` when a workflow hit a `pause()` call.
>>>>>>> origin/main
- Keep resuming the same session until the workflow completes or pauses again.

```bash
npx libretto resume --session debug-example
```

### `save`

<<<<<<< HEAD
- Use `save` only when the user explicitly asks to save or reuse authenticated browser state.
=======
- Use `save` when the user logs in manually and wants to reuse that authenticated browser state later.
>>>>>>> origin/main

```bash
npx libretto save app.example.com
```

### `close`

<<<<<<< HEAD
- Use `close` when the user is done with the session or an exploration session is no longer helping progress (unless the user asked to keep watching that browser).
=======
- Use `close` only when the user is done with the session.
>>>>>>> origin/main
- `close --all` is available for workspace cleanup.

```bash
npx libretto close --session debug-example
npx libretto close --all
```

<<<<<<< HEAD
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
=======
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
Assistant: [Uses `network`, `snapshot`, and `exec` as needed to understand the site and decide the implementation path]
Assistant: [Reads `references/code-generation-rules.md` before writing production workflow code]
Assistant: I found the working path. I'll now update the workflow file outside Libretto and verify it with `npx libretto run ...`.
</example>
```

### Debugging existing workflows

```text
<example>
[Context: The user has an existing Libretto workflow that is failing]
Assistant: I'll reproduce the failure first so we can inspect the exact browser state it leaves behind.
Assistant: [Runs `npx libretto run ./integration.ts main --session debug-flow --headed`]
Assistant: The workflow failed and Libretto kept the browser open. I'll inspect the page state before changing code.
Assistant: [Runs `npx libretto snapshot --session debug-flow --objective "Find the blocking error or broken selector target" --context "The workflow just failed after trying to continue from the review step, and I need to identify the visible blocker on the current page."`]
Assistant: [Runs `npx libretto exec --session debug-flow "...focused inspection or prototype..."`]
Assistant: [Reads `references/code-generation-rules.md` before patching the workflow file]
Assistant: I found the issue. I'll patch the workflow code, then rerun `npx libretto run ...` to verify the fix.
</example>
```
>>>>>>> origin/main

## References

- Read `references/configuration-file-reference.md` when you need to inspect or change `.libretto/config.json` for snapshot model selection or viewport defaults.
- Read `references/site-security-review.md` before reviewing the site's security posture and deciding whether to lead with network requests, passive interception, or Playwright DOM automation on a new site.
- Read `references/code-generation-rules.md` before writing or editing production workflow files.
<<<<<<< HEAD
- Read `references/auth-profiles.md` when auth-profile behavior is relevant.
- Read `references/pages-and-page-targeting.md` when a session has multiple open pages or you need `--page`.
- Read `references/action-logs.md` for full action log field descriptions and user-vs-agent event semantics.
=======
- Read `references/auth-profiles.md` when the site requires login and the simplest path is to save local browser state.
- Read `references/pages-and-page-targeting.md` when a session has multiple open pages or you need `--page`.
>>>>>>> origin/main
