---
name: libretto-network-skill
description: "Browser automation CLI for building integrations, with a network-first approach.\n\nWHEN TO USE THIS SKILL:\n- When building a new integration or data extraction workflow against a website\n- When you need to interact with a web page (click, fill, navigate) rather than just read it\n- When debugging browser agent job failures (selectors timing out, clicks not working, elements not found)\n- When you need to test or prototype Playwright interactions before codifying them\n- When you need to save or restore login sessions for authenticated pages\n- When you need to understand what's on a page (use the snapshot command)\n- When scraping dynamic content that requires JavaScript execution\n\nWHEN NOT TO USE THIS SKILL:\n- When you only need to read static web content (use read_web_page instead)\n- When you need to modify browser agent source code (edit files directly)\n- When you need to run a full browser agent job end-to-end (use npx browser-agent CLI)"
---

# Browser Integration with Libretto CLI

Use the `npx libretto` CLI to automate web interactions, debug browser agent jobs, and prototype fixes interactively.

## Ask, Don't Guess

If it's not obvious which element to click or what value to enter, **ask the user** — don't try multiple things hoping one works. Present what you see on the page and let the user tell you where to go. One question is faster than a 30-second timeout from a wrong guess.

## Commands

```bash
npx libretto open <url> [--headed]     # Launch browser and navigate (headless by default)
npx libretto exec <code> [--visualize] # Execute Playwright TypeScript code (--visualize enables ghost cursor + highlight)
npx libretto run <integrationFile> <integrationExport> # Execute integration actions
npx libretto session-mode <read-only|interactive> [--session <name>] # Set session mode explicitly
npx libretto snapshot --objective "<what to find>" --context "<situational info>"
npx libretto save <url|domain>         # Save session (cookies, localStorage) to .libretto-cli/profiles/
npx libretto network                   # Show last 20 captured network requests
npx libretto actions                   # Show last 20 captured user/agent actions
npx libretto close                     # Close the browser
```

All commands accept `--session <name>` for isolated browser instances (default: `default`).
Built-in sessions: `default`, `dev-server`, `browser-agent`.

## Interactive Consent Rule

After starting a session with `open` (or when preparing to use `run`), ask:
"Do you want this session to be interactive?"

- If user says **no**, keep it read-only and use read-only-safe commands (`snapshot`, `network`, `actions`).
- If user says **yes**, run `npx libretto session-mode interactive --session <name>` and then proceed with `exec`/`run`.
- Never change session mode unless the user explicitly approves.

## Visualize Mode (`--visualize`)

Add `--visualize` to any `exec` command to show a ghost cursor and element highlight before each action executes. Use it when the user wants to see what will be clicked/filled before it happens.

## Globals Available in `exec`

`page`, `context`, `state`, `browser`, `networkLog({ last?, filter?, method? })`, `actionLog({ last?, filter?, action?, source? })`, `console`, `fetch`, `Buffer`, `URL`, `setTimeout`

The `state` object persists across `exec` calls within the same session — use it to carry values between commands.

## Workflow: Browse and Interact

```bash
# Open a page
npx libretto open https://example.com
# Ask user if they want interactive mode
# If yes:
npx libretto session-mode interactive --session default

# Interact with elements
npx libretto exec "await page.locator('button:has-text(\"Sign in\")').click()"
npx libretto exec "await page.fill('input[name=\"email\"]', 'user@example.com')"

# Understand the page — always provide objective and context
npx libretto snapshot \
  --objective "Find the sign-in form fields and submit button" \
  --context "Navigated to example.com login page. Expecting email/password inputs and a submit button."

# Include relevant network calls in context when debugging API interactions
npx libretto snapshot \
  --objective "Find why the referral list is empty" \
  --context "Logged into eClinicalWorks. Clicked Open Referrals tab. Table appears but shows no rows. Recent POST to /servlet/AjaxServlet returned 200 but with empty body."

# Done
npx libretto close
```

## Workflow: Save and Restore Login Sessions

Profiles persist cookies and localStorage across browser launches. They are saved to `.libretto-cli/profiles/<domain>.json` (git-ignored) and loaded automatically on `open`.

```bash
# Open a site in headed mode so you can log in manually
npx libretto open https://portal.example.com --headed

# ... manually log in in the browser window ...

# Save the session
npx libretto save portal.example.com

# Next time you open this domain, you'll be logged in automatically
npx libretto open https://portal.example.com
```

## Workflow: Interactive Debugging

When browser automation jobs fail (selectors timing out, clicks not working), use the interactive debugging workflow instead of edit-restart cycles. This reduces iteration time from 5-10 minutes to ~30 seconds.

1. Add `page.pause()` before the problematic code section
2. Start the job with `npx browser-agent start` (debug mode is always enabled locally)
3. Wait ~60 seconds for the browser to hit the breakpoint
4. Ask user if they approve interactive mode for `browser-agent`
5. If approved, run `npx libretto session-mode interactive --session browser-agent`
6. Use `npx libretto exec` (with `--session browser-agent`) to inspect and prototype fixes
7. Once the fix works, codify it in source files
8. Restart the job to verify end-to-end

```bash
# Start job in background
npx browser-agent start \
  --job-type pull-open-referrals \
  --tenant-slug hhb \
  --params '{"vendorName":"eClinicalWorks"}'

# Inspect page state
npx libretto session-mode interactive --session browser-agent
npx libretto exec --session browser-agent "return await page.url();"
npx libretto snapshot --session browser-agent \
  --objective "Find dropdown menus and their current selections" \
  --context "Browser agent hit breakpoint during pull-open-referrals job. Need to inspect dropdown state."

# List dropdown options
npx libretto exec --session browser-agent "return await page.locator('option').allTextContents();"

# Test a fix
npx libretto exec --session browser-agent "await page.locator('.dropdown-trigger').click(); return 'clicked';"
```

## Snapshot — The Primary Observation Tool

The `snapshot` command captures a PNG screenshot + HTML, sends both to a vision model (Gemini Flash), and returns an analysis with Playwright-ready selectors. **Both `--objective` and `--context` are required.** This is the single way to understand what's on the page — use it any time you need to inspect page structure, find elements, or debug what's happening.

**Never use `page.screenshot()` via `exec` to understand the page.** Use the `snapshot` command instead — it captures the screenshot, HTML, and sends both to a vision model that returns actionable selectors. Raw screenshots give you an image with no analysis; `snapshot` gives you the answer.

### What to Put in `--objective`

The objective tells the vision agent what you're looking for. Be specific:

- "Find the referral status column in the table"
- "Find the error message or alert preventing form submission"
- "Identify all dropdown menus on the page and their current selections"

### What to Put in `--context`

Context gives the vision agent situational awareness. Include:

1. **Where you are** — page, step, state (e.g., "On the eClinicalWorks referral list page")
2. **What you did** — actions taken (e.g., "Clicked 'Open Referrals' tab, selected department 'Cardiology'")
3. **What you expect** — desired state (e.g., "Expecting a table of open referrals with patient names")
4. **Relevant selectors** — any CSS selectors, data-testids, or element identifiers you already know about
5. **Task context** — what the automation is trying to accomplish overall
6. **Network calls** — any relevant HTTP requests/responses (e.g., "POST /api/referrals returned 200 with empty array")

```bash
npx libretto snapshot \
  --objective "Find the referral status column in the table" \
  --context "Logged into eClinicalWorks as admin. Navigated to Referrals > Open Referrals tab. Expecting a table of open referrals with columns for patient name, provider, and status."

# Debugging example
npx libretto snapshot \
  --objective "Find the error message or alert" \
  --context "Clicked Submit on the new referral form after filling in all required fields. Expected to see a success confirmation, but the page appears to still be on the form."
```

## Inspecting Raw DOM with `exec`

When the snapshot doesn't give you enough detail — why an element is hidden, what directives or event handlers it has, how it's styled — use `exec` with `page.evaluate` to query the raw DOM directly.

- **`outerHTML`** — See the complete markup of an element including all attributes.
  ```bash
  npx libretto exec "const el = await page.locator('#myElement').elementHandle(); return await page.evaluate(el => el.outerHTML.substring(0, 500), el);"
  ```
- **Computed styles / parent chain** — Debug why Playwright can't click an element.
  ```bash
  npx libretto exec "const el = await page.locator('#myElement').elementHandle(); return await page.evaluate(el => { const chain = []; let n = el; for (let i = 0; i < 8 && n; i++) { const s = getComputedStyle(n); chain.push({ tag: n.tagName, id: n.id, display: s.display, visibility: s.visibility }); n = n.parentElement; } return chain; }, el);"
  ```
- **Any DOM property** — `page.evaluate` gives you full access: `getBoundingClientRect()`, `dataset`, `children`, `classList`, attached event listeners, etc.

## Tips

- **Never use `page.screenshot()` via `exec`.** Use `npx libretto snapshot` instead — it captures the viewport, sends the screenshot + HTML to a vision model, and returns actionable selectors. The `fullPage` option is especially dangerous — it scrolls the entire page to stitch a screenshot, which can crash JavaScript-heavy pages (especially EMR portals like eClinicalWorks).
- **Never run `exec` commands in parallel.** Always wait for one `exec` to finish before starting the next. Do not use `run_in_background` for `exec` calls. Running simultaneous `exec` calls opens multiple CDP connections to the same page, which corrupts the page state and kills the browser.
- If `open` is called when a session already has a browser running, it navigates the existing browser to the new URL instead of launching a new one.
- Use `return <value>` in `exec` to print results. Strings print raw; objects print as JSON.
- For iframe content, access via `page.locator('iframe[name="..."]').contentFrame()`.
- Multiple sessions allow parallel browser instances: `--session test1`, `--session test2`.

## Network Logging

Network requests are captured automatically when a browser is opened via `npx libretto open`. All non-static HTTP responses (excluding `.css`, `.js`, `.png`, `.jpg`, `.gif`, `.woff`, `.ico`, `.svg`, and `chrome-extension://` URLs) are logged to `tmp/libretto-cli/<runId>/network.jsonl`.

### CLI: `npx libretto network`

```bash
npx libretto network                              # show last 20 requests
npx libretto network --last 50                    # show last 50
npx libretto network --filter 'referral|patient'  # regex filter on URL
npx libretto network --method POST                # filter by HTTP method
npx libretto network --clear                      # truncate the log file
```

### In exec: `networkLog()`

```bash
npx libretto exec "return await networkLog()"
npx libretto exec "return await networkLog({ filter: 'servlet', last: 5 })"
npx libretto exec "return await networkLog({ method: 'POST' })"
```

Returns an array of objects with: `ts`, `method`, `url`, `status`, `contentType`, `postData` (POST/PUT/PATCH only, first 2000 chars), `size`, `durationMs`.

**Note:** Network logging only works for sessions opened via `npx libretto open`. It does not capture requests for external sessions like `--session browser-agent`.

## Action Logging

Browser actions are captured automatically when a browser is opened via `npx libretto open`. Both user interactions (manual clicks, typing in the headed browser window) and agent actions (programmatic Playwright API calls via `exec`) are logged to `tmp/libretto-cli/<runId>/actions.jsonl` with a `source` field of `'user'` or `'agent'` to distinguish the two.

### CLI: `npx libretto actions`

```bash
npx libretto actions                              # show last 20 actions
npx libretto actions --last 50                    # show last 50
npx libretto actions --filter 'button|input'      # regex filter on selector/value
npx libretto actions --action click                # filter by action type
npx libretto actions --source user                 # only manual user actions
npx libretto actions --source agent                # only programmatic agent actions
npx libretto actions --clear                       # truncate the log file
```

### In exec: `actionLog()`

```bash
npx libretto exec "return await actionLog()"
npx libretto exec "return await actionLog({ source: 'user', last: 5 })"
npx libretto exec "return await actionLog({ action: 'click' })"
```

Returns an array of objects with: `ts`, `action`, `source` (`'user'` | `'agent'`), `selector`, `value`, `url`, `duration`, `success`, `error`.

**Note:** Action logging only works for sessions opened via `npx libretto open`. It does not capture actions for external sessions like `--session browser-agent`.

## Workflow: Creating a New Integration

Use Libretto CLI interactively to build a brand new integration from scratch. Navigate the real site with the user, discover the network endpoints, and codify the data extraction into a reusable TypeScript script.

**IMPORTANT:** Do NOT explore the codebase or research existing code before starting. This skill file and the CLI commands below contain everything you need. Jump straight into using the CLI interactively — ask the user for the URL, open the browser, and start working. The only exception is if the user mentions a specific file or piece of code to reference — then read that specific file first, but nothing more.

### Before You Start: Clarify the Approach

Before opening the browser, check whether the user's prompt already specifies:

1. **Which integration approach to use** — Did they say to use network requests (`page.evaluate(fetch(...))`), Playwright DOM automation, or a specific strategy?
2. **Whether to run a security posture review** — Did they ask you to assess the site's bot detection, fetch interception, or security posture?

**If the user specified an approach**, use it — skip the security review and go with what they asked for.

**If the user asked for a security review**, run the security posture review described below.

**If neither is specified**, ask the user before proceeding:

> "Before we start — would you like me to run a security posture review on the site to determine the best integration approach? Or would you prefer I default to the network-first approach (using `page.evaluate(fetch(...))`) and fall back to Playwright automation if that doesn't work?"

Once you have the answer, proceed accordingly.

### Security Posture Review

Run the probes from `integration-approach-selection.md` (in this skill's directory). This answers one question: **which approaches are safe to use on this site?**

The output is a Site Assessment Summary that tells you:
- Whether `page.evaluate(fetch(...))` is safe (fetch not patched, no aggressive bot detection)
- Whether `page.on('response', ...)` interception is viable
- Whether you need to restrict to DOM-only extraction

**Present the security assessment to the user and get their input** before proceeding. The user may have context about the site that affects the approach (e.g., they know the site uses a specific framework, or they've tried certain approaches before).

Once approved, use the security-recommended approach as you build the integration.

### Handling Approach Mismatches

The security review tells you what's *safe*, but not necessarily what *works* for every endpoint or data source on the site. As you build the integration, you may find that the recommended approach doesn't produce usable data for a specific part of the workflow. When this happens, **explain what you found, adapt your approach** for that specific part, and keep going.

Common mismatches:

- **Unparseable response format** — The fetch call succeeds but returns a proprietary format (RSC wire protocol, protobuf, encrypted payloads) instead of parseable JSON/XML/HTML.
- **Data not in API responses** — The data is server-rendered into HTML or computed client-side; no network response contains it.
- **Endpoint requires unpredictable parameters** — CSRF tokens, request signatures, or session values that rotate and aren't easily extractable.

These can surface at any point — the first endpoint you try or the fifteenth. Different parts of the same integration often need different approaches.

### Starting the Session

The browser stays open indefinitely until explicitly closed with `npx libretto close` or by the user closing the window. **Do not** set any timeouts, auto-close timers, or call `close` until the user says the workflow session is done. Ensure that you open the browser in `--headed` mode so the user can see what's happening.

**Do NOT ask the user about saved login sessions.** Do not ask if they have a saved session or if they need to log in. Always open the page in `--headed` mode and let the user log in manually in the browser window. Do not use `npx libretto save` during workflow creation.

### Integration Approaches

There are two main approaches for building an integration. **Try the network-first approach first** — it's faster, more reliable, and less brittle. Fall back to Playwright automation if it doesn't work. Be flexible — different parts of the same integration may use different approaches, and a single workflow often mixes them. The user can also explicitly tell you which approach to use.

#### Approach 1: Network-First — `page.evaluate(() => fetch(...))` (Try First)

Use `page.evaluate(() => fetch(...))` to make requests directly in the browser's JavaScript context — for both extracting data and performing actions (form submissions, API calls, etc.). The requests share the browser's TLS fingerprint, cookies, and origin, so they look identical to requests the site's own JS would make.

**Why this is preferred:** Maximum control and reliability. You call exactly the endpoints you want with the parameters you want, skip fragile UI rendering, and get structured data back. No brittle DOM selectors, no multi-step UI sequences that break when the site changes its layout.

**How to try it:**

1. Use Playwright to navigate the site normally. Network requests are captured automatically.
2. Check the network log (`npx libretto network` or `networkLog()`) to find API endpoints the site uses.
3. Recreate a key request with `page.evaluate(() => fetch(...))` and confirm it works.

If the fetch call succeeds, this is your approach. You'll still use Playwright for navigation, login, and session setup — but data extraction and actions go through direct fetch calls.

**When it won't work:** If `fetch` is monkey-patched, the site detects non-app-originated requests, or the API uses request signatures you can't replicate.

#### Approach 2: Playwright Automation (Fallback)

If direct fetch calls don't work, fall back to driving the UI with Playwright — clicking elements, filling forms, reading text from the DOM.

**How to try it:**

1. Navigate to the page.
2. Use `npx libretto snapshot` to find selectors.
3. Drive the UI with Playwright locators (`page.locator(...).click()`, `.fill()`, `.textContent()`, etc.).

This works regardless of the site's architecture but is slower and more fragile against layout changes.

**Supplementing with `page.on('response', ...)`:** When using Playwright automation, you can optionally listen to network responses the browser makes as you navigate — `page.on('response', ...)` lets you capture API data that flows through the site's own code without making extra requests. This is useful when the site has API endpoints but blocks direct fetch calls. Set up listeners before the navigation that triggers the requests. Not all sites will have useful responses to intercept — some are entirely server-rendered.

**The workflow for form submissions and data-heavy actions:**

1. Use Playwright to fill out the form, select dropdowns, check boxes — whatever the UI requires
2. **Ask the user for confirmation before submitting** — describe what you're about to submit and wait for approval
3. Submit the form — network requests are captured automatically (see "Network Logging" above)
4. Check the captured requests with `npx libretto network --method POST` or `networkLog()`
5. Inspect the captured request (URL, method, headers, body) to understand the payload structure
6. Test recreating that request directly via `page.evaluate(() => fetch(...))` — confirm with the user before sending
7. In the generated production code, skip the form-filling steps and fire the network request directly, parameterized with the relevant input values

### Discovering Network Endpoints

Network requests are captured automatically in the background (see "Network Logging" above). Use the network log to discover endpoints instead of manually attaching listeners.

```bash
# Fill out a form
npx libretto exec "await page.locator('#department').selectOption('Cardiology'); return 'selected';"
npx libretto exec "await page.locator('#status').selectOption('Open'); return 'selected';"

# ASK THE USER before submitting — describe what will be submitted
# Then submit and check what requests fired
npx libretto exec "await page.locator('#submitBtn').click(); await page.waitForTimeout(3000); return 'submitted';"
npx libretto network --method POST --last 5

# Or query the log programmatically
npx libretto exec "return await networkLog({ method: 'POST', last: 5 })"
```

For page-load requests (data fetched during navigation), just navigate and then check the log:

```bash
npx libretto exec "await page.goto('https://portal.example.com/encounters'); await page.waitForTimeout(3000); return 'loaded';"
npx libretto network --last 20
```

### Testing a Captured Endpoint

**Before making any `fetch()` call (GET or POST), always confirm with the user first.** These hit real server endpoints with real session auth — a wrong request could submit data, modify records, or trigger side effects. Describe the URL, method, and parameters you want to test and wait for approval.

Note: `page.evaluate(() => fetch(...))` works for replaying both fetch-based and XHR-based endpoints — you're making a new request, not replaying the original mechanism.

```bash
# Recreate the captured request directly — confirm with user first
npx libretto exec "
  const resp = await page.evaluate(async () => {
    const r = await fetch('/servlet/AjaxServlet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=getReferrals&department=Cardiology&status=Open'
    });
    return await r.text();
  });
  return resp.substring(0, 1000);
"

# Extract session variables (safe — reads window properties, no server call)
npx libretto exec "
  return await page.evaluate(() => ({
    sessionDID: (window as any).sessionDID,
    userId: (window as any).TrUserId
  }));
"
```

### When to Generate the File

After completing the interactive exploration (navigating pages, inspecting elements, confirming selectors work), **always generate the TypeScript workflow file before ending the session** — do not wait for the user to ask for it separately.

**STOP AND ASK BEFORE GENERATING CODE.** Once the interactive workflow is figured out, you MUST pause and ask the user the following before writing any production code:

1. "Are there any existing files or patterns in the codebase you want me to reference?"
2. "Do you want me to incorporate any of your manual browser interactions from the actions log (`npx libretto actions --source user`) into the generated code?"
3. "Any other guidance for how the production code should be structured?"

Wait for the user's response. If they point you to files, read those first. If they say yes to the actions log, run `npx libretto actions --source user` and incorporate the relevant actions. If they give structural guidance, follow it. Only then proceed to generate.

After getting the user's input:

1. Generate the workflow file using proper Playwright APIs (see rules below)
2. Run the TypeScript type checker against the file and fix any errors before presenting it as done

### Generating the Workflow File

As you confirm each step works via `exec`, build up a TypeScript file in `apps/browser-agent/src/` (location depends on what the workflow does — new tasks go in `src/tasks/`, integration-specific logic in `src/integrations/`).

For workflows that use network requests for data extraction or form submission, follow the API client class pattern: a shared class with one method per endpoint, `page.evaluate(() => fetch(...))` under the hood, no try-catch in API methods (errors handled in the orchestrator). See `apps/browser-agent/docs/full-network-iteration-doc.md` for the full pattern.

### Code Rules for Generated Files

Before writing any production code, read `code-generation-rules.md` (in this skill's directory) for the full rules on Playwright locator usage, `page.evaluate()` restrictions, network request patterns, and type checking requirements.

## Patient Safety Warning

Browser automation jobs process real patient health information. The `npx libretto` CLI executes arbitrary code with full page access. **Never** execute code that submits forms, sends referrals, deletes data, or modifies patient records.

See `apps/browser-agent/docs/interactive-debugging-workflow.md` for the complete debugging guide.
