---
name: libretto
description: "Browser automation CLI for building, maintaining, and running browser automation workflows by inspecting live pages and prototyping interactions."
license: MIT
metadata:
  author: saffron-health
  version: "0.6.18"
---

## How Libretto Works

- Libretto is a CLI for exploring live websites and building or debugging reusable browser automation scripts.
- Use Libretto commands to inspect the site and open pages, observe state, inspect requests, and prototype interactions.
- Libretto work must end in script changes. Create or edit the workflow file instead of stopping at interactive exploration.

## Shipped Source & Documentation

The npm package includes `src/` (full TypeScript source) and `docs/` for deeper understanding of internals and design decisions. Read these when you need implementation context beyond what this skill file covers. Resolve paths from the package root (e.g. `node_modules/libretto/`).

Full documentation is published at [libretto.sh](https://libretto.sh). Available pages:

- Get started: [quickstart](https://libretto.sh/docs/get-started/quickstart), [first workflow](https://libretto.sh/docs/get-started/first-workflow), [deploying](https://libretto.sh/docs/get-started/deploying)
- Fundamentals: [core concepts](https://libretto.sh/docs/understand-libretto/core-concepts), [how workflow generation works](https://libretto.sh/docs/understand-libretto/how-workflow-generation-works), [automation and bot detection](https://libretto.sh/docs/understand-libretto/automation-and-bot-detection), [website authentication](https://libretto.sh/docs/understand-libretto/website-authentication)
- Workflow guides: [one-shot generation](https://libretto.sh/docs/guides/one-shot-workflow-generation), [interactive building](https://libretto.sh/docs/guides/interactive-workflow-building), [debugging workflows](https://libretto.sh/docs/guides/debugging-workflows), [convert to network requests](https://libretto.sh/docs/guides/convert-to-network-requests)
- CLI reference: [open and connect](https://libretto.sh/docs/reference/cli/open-and-connect), [sessions](https://libretto.sh/docs/reference/cli/sessions), [profiles](https://libretto.sh/docs/reference/cli/profiles), [snapshot](https://libretto.sh/docs/reference/cli/snapshot), [exec](https://libretto.sh/docs/reference/cli/exec), [run and resume](https://libretto.sh/docs/reference/cli/run-and-resume), [session logs](https://libretto.sh/docs/reference/cli/session-logs), [pages](https://libretto.sh/docs/reference/cli/pages)
- Library API: [workflow](https://libretto.sh/docs/reference/runtime/workflow), [AI extraction](https://libretto.sh/docs/reference/runtime/ai-extraction), [network requests](https://libretto.sh/docs/reference/runtime/network-requests), [file downloads](https://libretto.sh/docs/reference/runtime/file-downloads)
- Libretto Cloud Hosting: [overview](https://libretto.sh/docs/libretto-cloud-hosting/overview), [authentication](https://libretto.sh/docs/libretto-cloud-hosting/authentication), [deployments](https://libretto.sh/docs/libretto-cloud-hosting/deployments)
- Alternative providers: [overview](https://libretto.sh/docs/alternative-providers/overview), [Kernel](https://libretto.sh/docs/alternative-providers/kernel), [Browserbase](https://libretto.sh/docs/alternative-providers/browserbase), [Steel](https://libretto.sh/docs/alternative-providers/steel), [GCP](https://libretto.sh/docs/alternative-providers/gcp), [AWS](https://libretto.sh/docs/alternative-providers/aws)

## Default Integration Approach

1. Call the site's fetch/XHR endpoints via browser-context `fetch()`.
2. If `references/site-security-review.md` (assess only once per site) rules `fetch()` unsafe, passively capture responses with `page.on('response', ...)`
3. Fall back to Playwright UI automation.

Mix strategies freely across steps on a site.

Prefer to enter sites at a user-facing URL (homepage, login, etc.) on the first navigation — deep URLs on a cold session are commonly blocked by edge bot protection.

## Setup

- Use `libretto setup` for first-time workspace onboarding. It installs Chromium and syncs skills.
- Use `libretto status` to inspect open sessions without triggering setup.

## Experiments

- Use `libretto experiments` to list internal feature flags and `libretto experiments describe <name>` for usage notes when an experiment is enabled.

## Working Rules

- Announce which session you are using and what page you are on.
- Ask instead of guessing when it is unclear what to click, type, or submit.
- Do not treat visibility as interactivity. If an element will not act, inspect blockers before retrying.
- Defer repo/code review until you begin generating code, unless the user explicitly asks for it earlier.
- Read and follow guidelines in `references/code-generation-rules.md` before generating or editing production workflow code.
- Validation requires a successful clean `run` with confirmation of the actual returned output, not just process success. Use the same headed or headless mode that the workflow run is already using.
- After validation, always show the user: (1) the output/results from the validation run, and (2) the same command so they can re-run it themselves. Include any `--params`, `--headed`, `--headless`, or `--auth-profile` flags the workflow needs.
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
npx libretto open https://example.com
npx libretto open https://example.com --read-only --session readonly-example
npx libretto open https://example.com --session debug-example
```

### `connect`

- Use `connect` to attach to any existing Chrome DevTools Protocol (CDP) endpoint — a browser started with `--remote-debugging-port`, an Electron app, or any other CDP-compatible target.
- After connecting, `exec`, `snapshot`, `pages`, and the rest of the session commands follow that session's stored mode.
- Libretto does not manage the connected process's lifecycle. `close` clears the session but does not terminate the remote process.
- Pass `--read-only` if the connected session must stay inspection-only from the start.

```bash
libretto connect http://127.0.0.1:9222 --session my-session
libretto connect http://127.0.0.1:9222 --read-only --session readonly-session
libretto connect http://127.0.0.1:9223 --session another-session
```

### `session-mode`

- Use `session-mode` to inspect whether an existing session is `write-access` or `read-only`.
- Only a user can change the session mode for an existing session. Never change a session's mode on your own — the user must change it themselves manually.
- `open`, `run`, and `connect` default new sessions to `write-access` unless the config sets `sessionMode` to `read-only`.
- Pass `--read-only` or `--write-access` to override the config default for a single command.

```bash
libretto session-mode --session my-session
```

### `snapshot`

- Use `snapshot` as the primary page observation tool.
- Run `snapshot` without `--objective` or `--context`; the command prints a screenshot path and compact accessibility tree for the current page.
- Run `snapshot <ref>` to inspect a subtree from the latest full snapshot. Use ref forms printed in the tree, such as `l16`; numeric-suffix aliases such as `e16` also match `l16`.
- Run an unscoped snapshot before using refs. Subtree snapshots capture a fresh screenshot but reuse the latest cached tree.
- Use it before guessing at selectors, after workflow failures, and whenever the visible page state is unclear.

```bash
libretto snapshot --session debug-example
libretto snapshot <ref> --session debug-example
libretto snapshot --session debug-example --page <page-id>
```

### `exec`

- Use `exec` for focused inspection and short-lived interaction experiments.
- Use `exec` to validate selectors, inspect data, or prototype a step before you encode it in the workflow file.
- Use `exec -` to run multi-line scripts from stdin, especially when the code is too long or complex for a command line argument.
- The `exec` REPL is persistent for each browser session. Define helper functions once and reuse them in later `exec` calls.
- Available globals: `page`, `frame`, `context`, `browser`, `fetch`, `Buffer`.
- Let failures throw. Do not hide `exec` failures with `try/catch` or `.catch()`.
- Do not run multiple `exec` commands in parallel.
- Do not use `exec` in read-only diagnosis flows. Use `readonly-exec` from the `libretto-readonly` skill for those sessions.
- After successful mutations, `exec` prints page-change diffs from compact snapshots.

```bash
libretto exec "await page.url()"
libretto exec "await page.locator('button:has-text(\"Continue\")').click()"
echo "async function textOf(selector) { return await page.locator(selector).textContent(); }" | libretto exec - --session debug-example
libretto exec --session debug-example "await textOf('h1')"
```

### `pages`

- Use `pages` when a popup, new tab, or second page appears.
- If `exec` or `snapshot` complains about multiple pages, list page ids first and then pass `--page`.

```bash
libretto pages --session debug-example
libretto exec --session debug-example --page <page-id> "await page.url()"
```

### `run`

- Use `run` to verify a workflow file after creating it or editing it. Use the same headed or headless mode for validation that the workflow run is already using. Plain `run` defaults to headed mode.
- Workflows define their input shape with a Zod schema (see `references/code-generation-rules.md`). `run` validates `--params` against that schema before calling the handler and prints a clear field-by-field error if the input doesn't match.
- Successful runs close the browser by default. Pass `--stay-open-on-success` when you need to inspect the completed state with `pages`, `snapshot`, or `exec`.
- Pass `--read-only` if the preserved session should come back locked for follow-up terminal inspection after the workflow run.
- If the workflow fails, Libretto keeps the browser open. Inspect the failed state with `snapshot` and `exec` before editing code.
- Insert `await pause(session)` statements in the workflow file when you need to stop at specific states for interactive debugging, like breakpoints in the browser flow.
- If the workflow pauses, resume it with `libretto resume --session <name>`.
- Re-run the same workflow after each fix to verify the browser behavior end to end.

```bash
libretto run ./integration.ts --params '{"status":"open"}'
libretto run ./integration.ts --read-only
libretto run ./integration.ts --stay-open-on-success
libretto run ./integration.ts --auth-profile app.example.com
```

### `resume`

- Workflows pause by calling `await pause("session-name")` in the workflow file. Import `pause` from `"libretto"`.
- `pause(session)` is a no-op when `NODE_ENV === "production"`.
- Use `resume` when a workflow hit a `pause()` call.
- Keep resuming the same session until the workflow completes or pauses again.

```bash
libretto resume --session debug-example
```

### `save`

- Use `save` only when the user explicitly asks to save or reuse authenticated browser state.

```bash
libretto save app.example.com
```

### `close`

- Use `close` when the user is done with the session or an exploration session is no longer helping progress (unless the user asked to keep watching that browser).
- `close --all` is available for workspace cleanup.

```bash
libretto close --session debug-example
libretto close --all
```

## Session Logs

Session state is stored in `.libretto/sessions/<session>/state.json`.

Session logs are JSONL files at `.libretto/sessions/<session>/`:

- CLI logs are in `.libretto/sessions/<session>/logs.jsonl`.
- Action logs are in `.libretto/sessions/<session>/actions.jsonl`.
- Network logs are in `.libretto/sessions/<session>/network.jsonl` and their corresponding raw request/response bodies are in `.libretto/sessions/<session>/raw-network/`.

Use `jq` to query jsonl logs directly — for any filtering, slicing, or inspection task.

```bash
# Last 20 action entries
tail -n 20 .libretto/sessions/<session>/actions.jsonl | jq .

# POST requests with captured response previews
jq 'select(.method == "POST" and .responseBodyPreview != null) | {id, resourceType, status, contentType, url, requestBodyPreview, responseBodyPreview, responseBodyPath}' .libretto/sessions/<session>/network.jsonl

# Read a saved response sidecar
gunzip -c .libretto/sessions/<session>/raw-network/000001.response.json.gz | jq .
```

### Action log (`actions.jsonl`)

Key fields: `ts` (ISO timestamp), `source` (`user` or `agent`), `action` (`click`, `fill`, `goto`, etc.), `selector` (locator used by the agent), `bestSemanticSelector` (canonical selector for user DOM events), `success` (boolean), `url` (navigation target), `value` (typed or submitted value), `error` (message on failure).

Read `references/action-logs.md` for full field descriptions and user-vs-agent entry semantics.

### Network log (`network.jsonl`)

Libretto logs useful `document`, `xhr`, `fetch`, and non-noisy mutating requests; obvious static/media/tracking noise is skipped.

Key fields: `id` (incrementing request id), `ts` (ISO timestamp), `pageId` (page target id), `method` (HTTP method, e.g. `GET`, `POST`), `url` (request URL), `resourceType` (browser resource type, e.g. `document`, `xhr`, `fetch`), `status` (HTTP status code, or null for failed requests), `statusText` (HTTP status text), `contentType` (response content type), `requestHeaders` (request headers), `responseHeaders` (response headers), `requestBodyPreview` (inline request body preview), `requestBodyPath` (gzipped full request body sidecar path), `requestBodyBytes` (request body byte size), `requestBodyTruncated` (true when the request body exceeded the save limit), `requestBodyOmittedReason` (why the request body was not captured), `responseBodyPreview` (inline response body preview), `responseBodyPath` (gzipped full response body sidecar path), `responseBodyBytes` (response body byte size), `responseBodyTruncated` (true when the response body exceeded the save limit), `responseBodyOmittedReason` (why the response body was not captured), and `errorText` (request failure or body read error).

## Examples

### Building new browser automation workflows

#### Interactive building

```text
<example>
[Context: The user wants to build a new browser workflow and does not yet know the page structure]
Assistant: I'll inspect the real site first if needed, but before I finish I'll create `target-workflow.ts` so the task produces reusable automation code.
Assistant: [Runs `libretto open https://target.example.com --headed`]
Assistant: [Reads `references/site-security-review.md` before choosing between passive network inspection, direct browser fetch calls, and Playwright-first automation]
Assistant: [Runs `libretto snapshot --session <session>`]
Assistant: [Uses `snapshot` and `exec` as needed to understand the site and decide the implementation path]
Assistant: [Reads `references/code-generation-rules.md` before writing production workflow code]
Assistant: I found the working path. I'll now create the workflow file and verify it.
Assistant: [Creates or edits `target-workflow.ts` following `references/code-generation-rules.md`]
Assistant: [Runs `libretto run ./target-workflow.ts --params '{"status":"open"}'` to validate]
Assistant: Validation passed. Here are the results:
[Shows the output/results from the validation run]
To run it again, use: libretto run ./target-workflow.ts --params '{"status":"open"}'
</example>
```

### Debugging existing workflows

```text
<example>
[Context: The user has an existing Libretto workflow that is failing]
Assistant: I'll reproduce the failure first so we can inspect the exact browser state it leaves behind.
Assistant: [Runs `libretto run ./integration.ts --session debug-flow`]
Assistant: The workflow failed and Libretto kept the browser open. I'll inspect the page state before changing code.
Assistant: [Runs `libretto snapshot --session debug-flow`]
Assistant: [Runs `libretto exec --session debug-flow "...focused inspection or prototype..."`]
Assistant: [Reads `references/code-generation-rules.md` before patching the workflow file]
Assistant: I found the issue. I'll patch the workflow code and verify.
Assistant: [Edits `integration.ts` following `references/code-generation-rules.md`]
Assistant: [Runs `libretto run ./integration.ts` to validate the fix]
Assistant: Fix verified. Here are the results:
[Shows the output/results from the validation run]
To run it again, use: libretto run ./integration.ts
</example>
```

## References

- Read `references/configuration-file-reference.md` when you need to inspect or change `.libretto/config.json` for viewport or session defaults.
- Read `references/site-security-review.md` before reviewing the site's security posture and deciding whether to lead with network requests, passive interception, or Playwright DOM automation on a new site.
- Read `references/code-generation-rules.md` before writing or editing production workflow files.
- Read `references/auth-profiles.md` when auth-profile behavior is relevant.
- Read `references/pages-and-page-targeting.md` when a session has multiple open pages or you need `--page`.
- Read `references/action-logs.md` for full action log field descriptions and user-vs-agent event semantics.
- If the workflow code is deployed to the Libretto Cloud platform and you need to reference its API docs, fetch [https://libretto.sh/docs/llms.txt](https://libretto.sh/docs/llms.txt) and follow the relevant page links.
