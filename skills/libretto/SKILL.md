---
name: libretto
description: "Browser automation CLI for inspecting live pages, prototyping interactions, and running browser workflows."
license: MIT
metadata:
  author: saffron-health
  version: "0.3.0"
---

# Libretto

Use `npx libretto` to inspect live browser state, prototype interactions, and run existing browser workflows.

## Intro

- Use this skill when the truth is on the page.
- Prefer Libretto when you need to see what the browser is doing, not when you only need to edit source files.
- Treat Libretto as a session-based workflow: open a page, inspect it, try a focused action, then turn what you learned into code outside the CLI.
- When building a new integration, prefer reverse-engineering network requests first. Fall back to browser automation when the request path is unclear, too fragile, or blocked by anti-bot systems.

## Setup

- Ask the user to set up snapshot analysis before relying on `snapshot` for page understanding.
- Use `npx libretto init` for first-time setup.
- If they already have credentials, `npx libretto ai configure openai|anthropic|gemini|vertex` is enough.

## Rules

- Announce which session you are using and what page you are on.
- Ask instead of guessing when it is unclear what to click, type, or submit.
- Use `snapshot` to understand unknown page state before trying multiple selectors.
- Get explicit user confirmation before mutating actions or replaying network requests that may have side effects.
- Never run multiple `exec` commands at the same time.
- Keep the browser session open until the user says the session is done.

## Commands

### `open`

- Open a page before using `exec` or `snapshot`.
- Use headed mode when the user needs to log in or watch the workflow.

```bash
npx libretto open https://example.com --headed
npx libretto open https://example.com --headless --session debug-example
```

### `exec`

- Use `exec` for focused inspection and short-lived interaction experiments.
- Let failures throw. Do not hide `exec` failures with `try/catch`.

```bash
npx libretto exec "return await page.url()"
npx libretto exec "return await page.locator('button').count()"
npx libretto exec --visualize "await page.locator('button:has-text(\"Continue\")').click()"
```

### `snapshot`

- Use `snapshot` as the primary page observation tool.
- Provide `--objective` unless you intentionally want capture-only output. Add `--context` when the current page state is not obvious.
- If you only need the PNG and HTML files, omit `--objective`. That runs capture-only mode and skips AI analysis.
- When using `--objective`, expect analysis to take time. Use a timeout of at least 2 minutes for shell-wrapped calls.

```bash
npx libretto snapshot
npx libretto snapshot --objective "Find the sign-in form and submit button"
npx libretto snapshot \
  --objective "Explain why the table is empty" \
  --context "I opened the referrals page and expected rows after applying filters."
```

### `run`

- Use `run` to execute an existing Libretto workflow.
- If the workflow fails, Libretto keeps the browser open. Inspect the failed state with `snapshot` and `exec` before editing code.
- If the workflow pauses, resume it with `npx libretto resume --session <name>`.
- Re-run the same workflow after each fix to verify the browser behavior end to end.

```bash
npx libretto run ./integration.ts main
npx libretto run ./integration.ts main --params '{"status":"open"}'
npx libretto run ./integration.ts main --auth-profile app.example.com --headed
```

## Examples

### Building new browser automation workflows

#### Interactive building

```text
<example>
[Context: The user wants to build a new browser workflow and does not yet know the page structure]
Assistant: Let me open the target page in headed mode so we can inspect the real workflow.
Assistant: [Runs `npx libretto open https://target.example.com --headed`]
Assistant: I'll first determine whether this flow can be built from captured network requests instead of UI-only automation.
Assistant: [Runs `npx libretto snapshot --objective "Find the next required action" --context "We are starting the workflow from the landing page."`]
Assistant: If the page exposes a clear and stable request path, I'll prioritize that. If the request path is unclear, fragile, or heavily defended, I'll fall back to browser automation.
Assistant: [Uses `network`, `snapshot`, and `exec` as needed to prove the approach]
Assistant: I found the working path. I'll now update the workflow file outside Libretto and verify it with `npx libretto run ...`.
</example>
```

#### Network requests

```text
<example>
[Context: The user wants to build an integration using network requests]
Assistant: [Reads `references/reverse-engineering-network-requests.md`]
Assistant: Let me open the page in headed mode. Perform the workflow and I'll use the network log to recreate it.
Assistant: [Runs `npx libretto open https://target.example.com --headed`]
[User performs workflow]
User: I've completed the workflow
Assistant: [Runs `npx libretto network --method POST --last 20`]
Assistant: I found the relevant requests. I'll recreate the workflow from those requests, then test the resulting script with `npx libretto run ...`.
</example>
```

### Debugging existing workflows

```text
<example>
[Context: The user has an existing Libretto workflow that is failing]
Assistant: I'll reproduce the failure first so we can inspect the exact browser state it leaves behind.
Assistant: [Runs `npx libretto run ./integration.ts main --session debug-flow --headed`]
Assistant: The workflow failed and Libretto kept the browser open. I'll inspect the page state before changing code.
Assistant: [Runs `npx libretto snapshot --session debug-flow --objective "Find the blocking error or broken selector target"`]
Assistant: [Runs `npx libretto exec --session debug-flow "...focused inspection or prototype..."`]
Assistant: I found the issue. I'll patch the workflow code, then rerun `npx libretto run ...` to verify the fix.
</example>
```

## References

- For reverse-engineering captured requests, read `references/reverse-engineering-network-requests.md`.
- For incorporating manual browser steps the user performed, read `references/user-action-log.md`.
- For saving and reusing login state, read `references/auth-profiles.md`.
- For multiple open pages and page targeting, read `references/pages-and-page-targeting.md`.
