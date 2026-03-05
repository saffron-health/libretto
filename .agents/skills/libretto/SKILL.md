---
name: libretto-cli
description: "Browser automation CLI using Playwright.\n\nWHEN TO USE THIS SKILL:\n- When you need to interact with a web page (click, fill, navigate) rather than just read it\n- When debugging browser agent job failures (selectors timing out, clicks not working, elements not found)\n- When you need to test or prototype Playwright interactions before codifying them\n- When you need to save or restore login sessions for authenticated pages\n- When you need to understand what's on a page (use the snapshot command)\n- When scraping dynamic content that requires JavaScript execution\n\nWHEN NOT TO USE THIS SKILL:\n- When you only need to read static web content (use read_web_page instead)\n- When you need to modify browser agent source code (edit files directly)\n- When you need to run a full browser agent job end-to-end (use npx browser-agent CLI)"
---

# Browser Automation with Libretto CLI

Use the `npx libretto` CLI to automate web interactions, debug browser agent jobs, and prototype fixes interactively.

## When to Use

- Navigating pages that require interaction, authentication, or dynamic content (instead of `read_web_page`)
- Debugging browser automation errors (clicks not working, selectors failing, elements not found)
- Testing interactions before codifying them in source files
- Saving and restoring login sessions across browser launches

## Assessing a Site's Security Posture

**Only do this when the user explicitly asks you to.** Do not proactively assess a site's security posture or run bot detection probes unless the user specifically requests it (e.g., "assess the security posture", "check for bot detection", "probe the site's defenses", "what integration approach should we use").

When asked, read the `integration-approach-selection.md` file in this skill's directory. It contains step-by-step probes to run against a live Chrome session and a decision framework for choosing a data capture strategy (fetch calls vs passive interception vs DOM extraction). After running the probes, produce the Site Assessment Summary described at the end of that document.

## Ask, Don't Guess

If it's not obvious which element to click or what value to enter, **ask the user** — don't try multiple things hoping one works. Present what you see on the page and let the user tell you where to go. One question is faster than a 30-second timeout from a wrong guess.

## Commands

```bash
npx libretto open <url> [--headless]   # Launch browser and navigate (headed by default)
npx libretto exec <code> [--visualize] # Execute Playwright TypeScript code (--visualize enables ghost cursor + highlight)
npx libretto snapshot --objective "<what to find>" --context "<situational info>"
npx libretto save <url|domain>         # Save session (cookies, localStorage) to .libretto-cli/profiles/
npx libretto network                   # Show last 20 captured network requests
npx libretto actions                   # Show last 20 captured user/agent actions
npx libretto close                     # Close the browser
```

All commands accept `--session <name>` for isolated browser instances (default: `default`).
Built-in sessions: `default`, `dev-server`, `browser-agent`.

## Visualize Mode (`--visualize`)

Add `--visualize` to any `exec` command to show a ghost cursor and element highlight before each action executes. Use it when the user wants to see what will be clicked/filled before it happens.

## Globals Available in `exec`

`page`, `context`, `state`, `browser`, `networkLog({ last?, filter?, method? })`, `actionLog({ last?, filter?, action?, source? })`, `console`, `fetch`, `Buffer`, `URL`, `setTimeout`

The `state` object persists across `exec` calls within the same session — use it to carry values between commands.

## Workflow: Browse and Interact

```bash
# Open a page
npx libretto open https://example.com

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
4. Use `npx libretto exec` (with `--session browser-agent`) to inspect and prototype fixes
5. Once the fix works, codify it in source files
6. Restart the job to verify end-to-end

```bash
# Start job in background
npx browser-agent start \
  --job-type pull-open-referrals \
  --tenant-slug hhb \
  --params '{"vendorName":"eClinicalWorks"}'

# Inspect page state
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

## Workflow: Creating a New Browser Automation Script

Use Libretto CLI interactively to build a brand new workflow file from scratch. Navigate the real site with the user, and codify each step into a reusable TypeScript script as you go. Workflows can use Playwright locators, direct network requests via `page.evaluate(() => fetch(...))`, or a mix of both — see "Choosing Between Playwright and Network Requests" below. Follow the "Ask Before Guessing" rules above — present what you see on the page and ask the user which elements to interact with rather than guessing.

**IMPORTANT:** Do NOT explore the codebase or research existing code before starting. This skill file and the CLI commands below contain everything you need. Jump straight into using the CLI interactively — ask the user for the URL, open the browser, and start working. The only exception is if the user mentions a specific file or piece of code to reference — then read that specific file first, but nothing more.

### Starting the Session

The browser stays open indefinitely until explicitly closed with `npx libretto close` or by the user closing the window. **Do not** set any timeouts, auto-close timers, or call `close` until the user says the workflow session is done. Ensure that you open the browser in `--headed` mode so the user can see what's happening.

**Do NOT ask the user about saved login sessions.** Do not ask if they have a saved session or if they need to log in. Always open the page in `--headed` mode and let the user log in manually in the browser window. Do not use `npx libretto save` during workflow creation.

### Choosing Between Playwright and Network Requests

As you explore interactively, the general pattern is:

- **Playwright for navigation and UI interaction** — Navigate pages, click through menus, fill out forms, and select dropdown options as the user directs.
- **Network requests for data extraction and form submissions** — Instead of codifying an entire form-fill-and-submit sequence in production code, use Playwright to fill the form interactively, capture the actual HTTP request the portal sends on submit, and recreate it directly with `page.evaluate(() => fetch(...))`. This is faster, more reliable, and less brittle than replaying a multi-step UI interaction.

**The user can also explicitly tell you which approach to use.** If they say "use Playwright for this" or "grab that via network request", follow their direction. If they don't specify and the right approach isn't obvious (e.g., a simple single-field search vs. a complex multi-step wizard), **ask the user** which approach they'd prefer.

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

#### Playwright Locators

When codifying UI interaction steps, **translate `npx libretto exec` code into proper Playwright locator APIs**. Do not copy-paste `page.evaluate()` / `document.querySelector()` patterns from the interactive session into the production file.

**Use Playwright locators for:**

| Operation        | Interactive (`exec`)                                        | Production file                                                        |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Click            | `page.evaluate(() => document.getElementById('x').click())` | `page.locator('#x').click()`                                           |
| Check state      | `page.evaluate(() => el.checked)`                           | `page.locator('#x').isChecked()`                                       |
| Read text        | `page.evaluate(() => el.textContent)`                       | `page.locator('#x').textContent()`                                     |
| Read all text    | `querySelectorAll(...).map(e => e.textContent)`             | `page.locator('.items').allTextContents()`                             |
| Element position | `el.getBoundingClientRect()`                                | `page.locator('#x').boundingBox()`                                     |
| Inline styles    | `el.style.top`                                              | `page.locator('#x').getAttribute('style')`                             |
| Count elements   | `querySelectorAll(...).length`                              | `page.locator('.items').count()`                                       |
| Select dropdown  | `selectEl.value = '...'`                                    | `page.locator('select').selectOption('...')`                           |
| Iterate elements | `querySelectorAll(...).forEach(...)`                        | `const items = await locator.all(); for (const item of items) { ... }` |

**When `page.evaluate()` is acceptable:** If there is genuinely no Playwright locator equivalent (e.g., reading `getComputedStyle()` on elements with no identifying class/ID), use a **string expression** passed to `page.evaluate()` to avoid DOM type errors in the Node.js TypeScript context:

```typescript
// String expression — TypeScript doesn't type-check the JS string
const data = (await page.evaluate(`(() => {
  const results = [];
  for (const div of document.querySelectorAll(".container div")) {
    if (getComputedStyle(div).backgroundColor === "rgb(255, 255, 128)")
      results.push(div.getAttribute("style") || "");
  }
  return results;
})()`)) as string[];
```

Do **not** use `/// <reference lib="dom" />` or add `"dom"` to the tsconfig lib — this project's tsconfig intentionally excludes DOM types.

- **The generated file must pass `npx tsc --noEmit -p apps/browser-agent/tsconfig.json`** before it's considered done. If there are DOM type errors (`document`, `HTMLElement`, `getComputedStyle`), convert to locator APIs or string-expression `page.evaluate()`.

#### Network Request Methods

When codifying network-based data extraction or form submissions, wrap `page.evaluate(() => fetch(...))` calls in typed methods on a shared API client class:

```typescript
class ApiClient {
	constructor(private page: Page) {}

	private async apiFetch(
		url: string,
		options?: { method?: string; body?: string },
	): Promise<string> {
		return await this.page.evaluate(
			async ({ url, method, body }) => {
				const init: RequestInit = { method: method ?? "GET" };
				if (body) {
					init.headers = {
						"Content-Type": "application/x-www-form-urlencoded",
					};
					init.body = body;
				}
				const response = await fetch(url, init);
				if (!response.ok) throw new Error(`${response.status} for ${url}`);
				return await response.text();
			},
			{ url, method: options?.method, body: options?.body },
		);
	}

	async fetchReferralList(status: string): Promise<Referral[]> {
		const raw = await this.apiFetch(`/api/referrals?status=${status}`);
		// parse and return typed data
	}
}
```

**Rules:** One method per endpoint. No try-catch in API methods — let errors propagate to the orchestrator. Parse XML/HTML inside `page.evaluate()` with `DOMParser`. Use string expressions for `page.evaluate()` to avoid DOM type errors (same rule as Playwright section above).

## Patient Safety Warning

Browser automation jobs process real patient health information. The `npx libretto` CLI executes arbitrary code with full page access. **Never** execute code that submits forms, sends referrals, deletes data, or modifies patient records.

See `apps/browser-agent/docs/interactive-debugging-workflow.md` for the complete debugging guide.
