# Code Generation Rules

These rules apply when generating production TypeScript files from interactive browser sessions. Read this file before writing any production code.

## Workflow File Structure

Generated files must export a `workflow()` instance so they can be run via `npx libretto run <file> <exportName>`. Import `workflow` and its types from `"libretto"`:

```typescript
import { workflow, pause, type LibrettoWorkflowContext } from "libretto";

type Input = {
  // Define the expected input shape — passed via --params JSON
  query: string;
  maxResults?: number;
};

type Output = {
  // Define what the workflow returns
  results: Array<{ name: string; value: string }>;
};

export const myWorkflow = workflow<Input, Output>(
  {},
  async (ctx, input): Promise<Output> => {
    const { page } = ctx;

    // workflow logic here — use ctx.page, ctx.logger, ctx.services
    await page.goto("https://example.com");
    // ...

    return { results: [] };
  },
);
```

**Key points:**

- The named export (e.g., `myWorkflow`) is what you pass as the second arg to `npx libretto run ./file.ts myWorkflow`
- `ctx` provides `page`, `logger`, and `services` (generic, default `{}`)
- `input` comes from `--params '{"query":"foo"}'` or `--params-file params.json` on the CLI
- If the site requires a saved login session, pass `--auth-profile <domain>` to the CLI (created via `npx libretto save <domain>`)
- Use `await pause()` (imported from `"libretto"`) to pause the workflow for debugging. It is a no-op in production.
- The browser is launched and closed automatically by the CLI — do not launch or close it in the handler

## Passing Application Dependencies via Services

Use the third generic on `workflow<Input, Output, Services>` to inject
dependencies that exist in your application but not in libretto's runtime
(DB transactions, API clients, caches, etc.):

```typescript
import { type Transaction } from "./db";

type MyServices = { tx?: Transaction };

export const myWorkflow = workflow<Input, Output, MyServices>(
  {},
  async (ctx, input) => {
    if (ctx.services.tx) {
      await ctx.services.tx.insert(/* ... */);
    } else {
      ctx.logger.info("No DB transaction — skipping write");
    }
    // ... browser automation ...
  },
);
```

In production, the caller passes services when invoking `.run()`:

```typescript
await myWorkflow.run(
  { page, logger, services: { tx } },
  input,
);
```

When running standalone via `npx libretto run`, services defaults to `{}`,
so mark fields optional for anything unavailable in that context.

## Playwright Locators for DOM Interaction

Generated code must use Playwright locator APIs for all DOM interactions. Do not use `page.evaluate()` with `document.querySelector`, `querySelectorAll`, `textContent`, `click()`, or other DOM APIs when a Playwright locator can do the same thing.

During the interactive `exec` phase, `page.evaluate` is fine for quick prototyping. In generated production code, translate those patterns into Playwright locators.

### Translation Table

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
| Scoped query     | `parent.querySelector('.child')`                            | `parentLocator.locator('.child').textContent()`                        |
| Batch extraction | `querySelectorAll('.item').forEach(e => { ... })`           | `for (const item of await locator.all()) { const text = await item.locator('.text').textContent(); ... }` |

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
const posts = await page.locator('.post').all();
for (const post of posts) {
  const name = await post.locator('.name').textContent();
  const content = await post.locator('.content').textContent();
}
```

```typescript
// DON'T — evaluate to count elements
const count = await el.evaluate(`(el) => el.querySelectorAll('.item').length`);

// DO
const count = await el.locator('.item').count();
```

```typescript
// DON'T — evaluate to read scoped text
const text = await post.evaluate(
  `(el) => el.querySelector('[data-view-name="foo"]')?.textContent`
);

// DO
const text = await post.locator('[data-view-name="foo"]').textContent();
```

### When `page.evaluate()` Is Acceptable

Use `page.evaluate()` only for operations that have no Playwright locator equivalent:

1. **Browser-native APIs** — `getComputedStyle()`, `window.*` globals, `document.cookie`, scroll position
2. **In-browser `fetch()` calls** — making HTTP requests from the browser context
3. **Parsing operations** — using `DOMParser` to parse HTML/XML strings inside the browser

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

One method per endpoint. No try-catch in API methods — let errors propagate to the orchestrator. Parse XML/HTML inside `page.evaluate()` with `DOMParser`. Use string expressions for `page.evaluate()` to avoid DOM type errors.

## Comments

Add comments throughout generated code to explain what each logical block is doing. Comments should describe **intent**, not restate the code. Group related actions under a single comment rather than commenting every line.

```typescript
// Log in with credentials
await page.locator('#username').fill(user);
await page.locator('#password').fill(pass);
await page.locator('#login').click();

// Extract author and content from each feed post
const posts = await page.locator('.post').all();
for (const post of posts) {
  const name = await post.locator('.name').textContent();
  const content = await post.locator('.content').textContent();
}
```

## Type Checking

The generated file must pass `npx tsc --noEmit` before it's considered done. If there are type errors around DOM access, prefer locator APIs first, then use focused `page.evaluate()` only for browser-native APIs.
