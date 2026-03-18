---
name: libretto
description: "Browser automation CLI for building, maintaining, and running browser automation workflows by inspecting live pages and prototyping interactions."
license: MIT
metadata:
  author: saffron-health
  version: "0.4.1"
---

# Libretto

Libretto is a CLI for building and maintaining browser automation scripts.
Use `npx libretto` to build or debug automations by inspecting live browser state, executing Playwright code, and running existing workflows.

## Intro

- Use this skill when the truth is on the page.
- Prefer Libretto when you need to build, maintain, or debug a browser automation script against the live site.
- Treat Libretto as a script-authoring workflow: choose or create a workflow file, inspect the page, try focused actions, then update code outside the CLI and verify it with `run`.
- If the user asks for a new automation or scrape and no workflow file exists yet, create one in the workspace instead of stopping at interactive exploration.
- For a new automation, make the workflow file a required deliverable before you finish the task, even if you inspect the site first.
- If the user does not provide a workflow path, choose a reasonable filename in the current workspace and create it yourself.
- When building a new integration, prefer reverse-engineering network requests first. Fall back to browser automation when the request path is unclear, too fragile, or blocked by anti-bot systems.
- Before replaying captured requests, run the security preflight in `references/reverse-engineering-network-requests.md` to assess whether direct browser `fetch` is safe to try.

## Setup

- Ask the user to set up snapshot analysis before relying on `snapshot` for page understanding.
- Use `npx libretto init` for first-time setup.
- If they already have credentials, `npx libretto ai configure openai|anthropic|gemini|vertex` is enough.

## Rules

- Announce which session you are using and what page you are on.
- When the task is to build or change an automation, create or update the workflow file and use Libretto commands to gather the information needed for that code change.
- For a new automation, you may use `open`, `snapshot`, or `exec` first to learn the page, but do not finish or reply as if the task is complete until the workflow file exists.
- Treat scrape and integration requests as requests for reusable automation code by default, not as requests to manually collect the final data in the live session.
- Ask instead of guessing when it is unclear what to click, type, or submit.
- Use `snapshot` to understand unknown page state before trying multiple selectors.
- Get explicit user confirmation before mutating actions or replaying network requests that may have side effects.
- Never run multiple `exec` commands at the same time.
- Keep the browser session open until the user says the session is done.

## Commands

### `open`

- Open a page before using `exec` or `snapshot`.
- Use `open` at the start of script authoring when you need live page state to decide how the workflow should work.
- Use headed mode when the user needs to log in or watch the workflow.

```bash
npx libretto open https://example.com --headed
npx libretto open https://example.com --headless --session debug-example
```

### `exec`

- Use `exec` for focused inspection and short-lived interaction experiments.
- Use `exec` to validate selectors, inspect data, or prototype a step before you encode it in the workflow file.
- Let failures throw. Do not hide `exec` failures with `try/catch`.

```bash
npx libretto exec "return await page.url()"
npx libretto exec "return await page.locator('button').count()"
npx libretto exec --visualize "await page.locator('button:has-text(\"Continue\")').click()"
```

### `snapshot`

- Use `snapshot` as the primary page observation tool.
- Use `snapshot` to understand the current page before editing the workflow when the structure or next step is unclear.
- When you want analysis, provide both `--objective` and `--context`.
- If you only need the PNG and HTML files, omit `--objective`. That runs capture-only mode and skips AI analysis.
- When using `--objective`, expect analysis to take time. Use a timeout of at least 2 minutes for shell-wrapped calls.

```bash
npx libretto snapshot
npx libretto snapshot \
  --objective "Find the sign-in form and submit button" \
  --context "I just opened the login page and need the email field, password field, and submit button."
npx libretto snapshot \
  --objective "Explain why the table is empty" \
  --context "I opened the referrals page and expected rows after applying filters."
```

### `run`

- Use `run` to verify a workflow file after creating it or editing it.
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
Assistant: I'll inspect the real site first if needed, but before I finish I'll create `./target-workflow.mjs` so the task produces reusable automation code.
Assistant: [Runs `npx libretto open https://target.example.com --headed`]
Assistant: I'll first determine whether this flow can be built from captured network requests instead of UI-only automation.
Assistant: [Runs `npx libretto snapshot --objective "Find the next required action" --context "We are starting the workflow from the landing page."`]
Assistant: I'll inspect the site's request path and security posture before deciding whether direct request replay is safe.
Assistant: [Uses `network`, `actions`, `snapshot`, and `exec` as needed to produce a site assessment]
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
Assistant: [Runs `npx libretto snapshot --session debug-flow --objective "Find the blocking error or broken selector target" --context "The workflow just failed after trying to continue from the review step, and I need to identify the visible blocker on the current page."`]
Assistant: [Runs `npx libretto exec --session debug-flow "...focused inspection or prototype..."`]
Assistant: I found the issue. I'll patch the workflow code, then rerun `npx libretto run ...` to verify the fix.
</example>
```

## References

- For reverse-engineering captured requests, read `references/reverse-engineering-network-requests.md`.
- For incorporating manual browser steps the user performed, read `references/user-action-log.md`.
- For saving and reusing login state, read `references/auth-profiles.md`.
- For multiple open pages and page targeting, read `references/pages-and-page-targeting.md`.
