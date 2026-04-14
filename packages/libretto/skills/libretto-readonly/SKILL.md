---
name: libretto-readonly
description: "Read-only Libretto workflow for diagnosing live browser state without clicks, typing, navigation, or mutation requests."
license: MIT
metadata:
  author: saffron-health
  version: "0.6.6"
---

## How Libretto Read-Only Works

- Use this skill when the browser session must stay strictly read-only.
- Libretto stores read-only vs write-access on the session itself.
- The primary inspection tools are `snapshot` and `readonly-exec`.
- `readonly-exec` reuses Libretto's normal execution pipeline, but it only exposes read-only helpers and denies mutating Playwright methods.
- Only a user can change the session mode for an existing session. Never change a session's mode on your own — the user must change it themselves manually.

## Working Rules

- Announce which session you are using and what page you are inspecting.
- Do not use `exec`, `run`, or any direct Playwright action that could change browser or application state.
- Do not click, type, submit forms, navigate, upload files, dispatch DOM events, or send non-GET requests.
- Prefer `snapshot` first when the visible page state is unclear.
- Use `readonly-exec` for focused inspection: titles, HTML, locator text, counts, visibility checks, and GET requests.
- Keep snippets small and purpose-built. Do not run multiple `readonly-exec` commands at the same time.
- End with diagnosis and handoff guidance, not an attempted in-browser repair.

## Commands

### `connect`

- Use `connect` to attach to an existing CDP endpoint for a preserved browser session.
- Use `--read-only` when creating the Libretto session handle for a preserved browser session.
- Libretto read-only mode is enforced through Libretto commands; direct CDP clients that skip Libretto are outside this boundary.

```bash
npx libretto connect http://127.0.0.1:9222 --read-only --session failed-job-debug
```

### `pages`

- Use `pages` when a popup, new tab, or second page exists.
- If `readonly-exec` or `snapshot` complains about multiple pages, list ids first and then pass `--page`.

```bash
npx libretto pages --session failed-job-debug
```

### `snapshot`

- Use `snapshot` as the first high-level observation tool.
- Always provide both `--objective` and `--context`.

```bash
npx libretto snapshot \
  --session failed-job-debug \
  --objective "Identify the visible failure state and likely blocking UI condition" \
  --context "The workflow already failed and the preserved browser must remain read-only."
```

### `readonly-exec`

- Use `readonly-exec` for narrow inspection code only.
- Denied operations fail with `ReadonlyExecDenied: ...`.

#### Helpers

- `page` — a read-only Playwright `Page` proxy. Standard Playwright read methods work normally (`url()`, `title()`, `content()`, `getByRole()`, `locator()`, `textContent()`, `isVisible()`, `count()`, `scrollIntoViewIfNeeded()`, etc.). Anything that mutates the page (`click`, `fill`, `goto`, `evaluate`, `keyboard`, `mouse`) is blocked.
- `state` — the current Libretto session state object.
- `get(url, options?)` — HTTP client restricted to **GET and HEAD** requests. Replaces `fetch`, which is blocked in readonly mode. Any request with a body or a non-GET/HEAD method throws `ReadonlyExecDenied`.
- `scrollBy(deltaX, deltaY)` — scroll the viewport by pixel offset. Use this to inspect content below the fold without targeting a specific element.

Standard JS globals `console`, `URL`, `Buffer`, `setTimeout`, and `setInterval` are also available.

#### Examples

```bash
npx libretto readonly-exec "return page.url()" --session failed-job-debug
npx libretto readonly-exec "return await page.getByRole('heading').first().textContent()" --session failed-job-debug

# HTTP GET inspection
echo "const r = await get('https://api.example.com/status'); return await r.json()" \
  | npx libretto readonly-exec - --session failed-job-debug

# Scroll down to inspect below-the-fold content
npx libretto readonly-exec "await scrollBy(0, 500)" --session failed-job-debug
```

### `close`

- Use `close` when the inspection session is no longer needed.

```bash
npx libretto close --session failed-job-debug
```
