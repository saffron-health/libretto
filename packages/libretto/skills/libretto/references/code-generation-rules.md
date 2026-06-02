# Code Generation Rules

These rules apply when generating production TypeScript files from interactive browser sessions. Read this file before writing any production code.

Follow the user's existing codebase conventions, abstractions, and patterns whenever possible. Do not introduce a new style unless the codebase does not already have a suitable one.

## Workflow File Structure

Generated files must default-export a `workflow()` instance so they can be run via `npx libretto run <file>`. Workflows declare their input and output shapes as Zod schemas, which both type the handler and validate runtime input.

Add `zod` (`^4.0.0`) to the workflow's `package.json` dependencies. Then import `workflow` from `"libretto"` and `z` from `"zod"`:

```typescript
import { z } from "zod";
import { workflow, pause, type LibrettoWorkflowContext } from "libretto";

const inputSchema = z.object({
  query: z.string(),
  maxResults: z.number().int().positive().optional(),
});

const outputSchema = z.object({
  results: z.array(z.object({ name: z.string(), value: z.string() })),
});

export default workflow(
  "myWorkflow",
  { input: inputSchema, output: outputSchema },
  async (ctx: LibrettoWorkflowContext, input) => {
    const { session, page } = ctx;

    console.log("workflow-start", { session, query: input.query });
    await page.goto("https://example.com");
    await pause(session);

    return { results: [] };
  },
);
```

Key points:

- `workflow(name, { input, output }, handler)` takes a unique workflow name, a pair of Zod schemas describing input and output, and the async handler. The handler's `input` parameter is inferred from the input schema — do not redeclare it with a separate `type Input = ...`.
- If the workflow needs runtime error handling, use `workflow(name, { schemas: { input, output }, pageFallback, handler })`. Libretto wraps the workflow `page` so supported Page and Locator failures can run `pageFallback` and then retry the original action once.
- At run time, Libretto validates `input` against `inputSchema` before calling the handler. Invalid input throws a clear error listing each failing field; the workflow handler never sees malformed input.
- `npx libretto run ./file.ts` executes the file's default-exported workflow, so always use `export default workflow(...)`.
- `ctx` provides `session` and `page`. Use `console.log`/`console.warn`/`console.error` for logging — the runtime wraps these with structured metadata automatically.
- `input` comes from `--params '{"query":"foo"}'` or `--params-file params.json` on the CLI, then gets parsed through `inputSchema`.
- Use `await pause(ctx.session)` (or `await pause(session)`) to pause the workflow for debugging. It is a no-op in production.
- After validation is complete and the workflow is confirmed working end to end, remove all `pause()` calls and pause-only workflow params unless the user explicitly says to keep them.
- The browser is launched and closed automatically by the CLI. Do not launch or close it in the handler.

## Workflow Error Handling

Do not add fallback logic by default. Add `pageFallback` only when exploration shows nondeterministic blockers such as popups, cookie banners, modals, or overlays.

Use `popupRecoveryFallback()` for generic popup and modal dismissal. Use a custom `PageFallback` function when the site needs specific recovery steps around the popup recovery agent. Tell the user when you add a fallback and keep primary workflow logic in the handler.

## Playwright DOM Interaction Rules

Generated code must use Playwright locator APIs for all DOM interactions. Do not use `page.evaluate()` with `document.querySelector`, `querySelectorAll`, `textContent`, `click()`, or other DOM APIs when a Playwright locator can do the same thing.

During the interactive `exec` phase, `page.evaluate` is fine for quick prototyping. In generated production code, translate those patterns into Playwright locators.

Before extracting data (for example text, rows, or field values), wait for the target content itself to be ready, not just its container.

## CAPTCHA Waits

If a CAPTCHA, Cloudflare challenge, or similar bot check appeared during exploration, preserve that recovery point in generated workflow code with an explicit 2 minute timeout wait. Put a short comment immediately above the wait linking to the hosted platform stealth docs:

```typescript
// Wait for hosted CAPTCHA solving; see https://libretto.sh/docs/libretto-cloud-hosting/stealth.
await page.waitForTimeout(120_000);
```

Use the wait only where a challenge was actually observed or is expected from the site's normal flow. After the wait, continue with a concrete locator or URL assertion for the real page state so the workflow fails clearly if the challenge was not solved.

### Anti-Patterns

These patterns come up frequently during interactive sessions and should not carry over into production code:

```typescript
// DON'T — batch-read via evaluate string
const data = await page.evaluate(`(() => {
  const posts = document.querySelectorAll('.post');
  return Array.from(posts).map(p => ({
    name: p.querySelector('.name')?.textContent,
    content: p.querySelector('.content')?.textContent,
  }));
})()`);

// DO — Playwright locators with a loop
const posts = await page.locator(".post").all();
for (const post of posts) {
  const name = await post.locator(".name").textContent();
  const content = await post.locator(".content").textContent();
}
```

```typescript
// DON'T — evaluate to count elements
const count = await el.evaluate(`(el) => el.querySelectorAll('.item').length`);

// DO
const count = await el.locator(".item").count();
```

```typescript
// DON'T — evaluate to read scoped text
const text = await post.evaluate(
  `(el) => el.querySelector('[data-view-name="foo"]')?.textContent`,
);

// DO
const text = await post.locator('[data-view-name="foo"]').textContent();
```

### When `page.evaluate()` Is Acceptable

Use `page.evaluate()` only for operations that have no Playwright locator equivalent:

1. Browser-native APIs: `getComputedStyle()`, `window.*` globals, `document.cookie`, scroll position
2. In-browser `fetch()` calls: making HTTP requests from the browser context
3. Parsing operations: using `DOMParser` to parse HTML/XML strings inside the browser

A quick test: if the evaluate body contains `querySelector`, `querySelectorAll`, `textContent`, `click()`, `getAttribute()`, or iterates DOM elements, it should be rewritten with Playwright locators.

When `page.evaluate()` is used for the acceptable cases above, keep the logic self-contained and return JSON-serializable values:

```typescript
const data = (await page.evaluate(`(() => {
  const style = getComputedStyle(document.documentElement);
  return style.getPropertyValue('--brand-color');
})()`)) as string;
```

Do not rely on broad DOM querying inside `page.evaluate()` for production flows when Playwright locators can express the same interaction.

## Network Request Methods

Network request methods are for active fetch/XHR endpoints the site already uses. Prefer them for data extraction or form submissions when the security review shows the path is safe and workable.

Before codifying a network request, confirm that the browser primitive matches how the site normally makes that request. Use `page.goto()` or link clicks for document navigation. Use `page.evaluate(fetch)` only for endpoints the site calls with fetch/XHR. Let the DOM load scripts, images, stylesheets, and iframes naturally, or create the corresponding DOM element if you truly need that request type.

Do not use `fetch()` to avoid UI navigation for page HTML or asset URLs. The request still comes from the browser, but the browser marks it as fetch/XHR with different request-context headers than a navigation, script, image, stylesheet, or iframe load. Do not try to fix that by copying headers, because the browser controls the request context. Prefer passive network interception when the site's own UI already triggers the useful request.

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

One method per endpoint. No try/catch in API methods. Let errors propagate to the orchestrator. Parse XML/HTML inside `page.evaluate()` with `DOMParser`. Use string expressions for `page.evaluate()` to avoid DOM type errors.

## Comments

Add comments throughout generated code to explain what each logical block is doing. Comments should describe intent, not restate the code. Group related actions under a single comment rather than commenting every line.

```typescript
// Log in with credentials
await page.locator("#username").fill(user);
await page.locator("#password").fill(pass);
await page.locator("#login").click();

// Extract author and content from each feed post
const posts = await page.locator(".post").all();
for (const post of posts) {
  const name = await post.locator(".name").textContent();
  const content = await post.locator(".content").textContent();
}
```

## Type Checking

The generated file must pass `npx tsc --noEmit` before it's considered done. If there are type errors around DOM access, prefer locator APIs first, then use focused `page.evaluate()` only for browser-native APIs.
