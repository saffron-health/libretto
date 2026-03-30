# Code Generation Rules

These rules apply when generating production TypeScript files from interactive browser sessions. Read this file before writing any production code.

Follow the user's existing codebase conventions, abstractions, and patterns whenever possible. Do not introduce a new style unless the codebase does not already have a suitable one.

## Workflow File Structure

Generated files must export a `workflow()` instance so they can be run via `npx libretto run <file> <workflowName>`. Import `workflow` and its types from `"libretto"`:

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
  "myWorkflow",
  async (ctx: LibrettoWorkflowContext, input): Promise<Output> => {
    const { session, page, logger } = ctx;

    logger.info("workflow-start", { session, query: input.query });
    await page.goto("https://example.com");
    await pause(session);

    return { results: [] };
  },
);
```

Key points:

- `workflow(name, handler)` takes a unique workflow name and returns the workflow object that Libretto can run.
- `npx libretto run ./file.ts myWorkflow` resolves `myWorkflow` from the workflows exported by `./file.ts`, so export or re-export the workflow from that file directly or through a `workflows` object, and make sure the run argument matches the name passed to `workflow("myWorkflow", ...)`.
- `ctx` provides `session`, `page`, `logger`, `storage`, and optional `credentials`
- `input` comes from `--params '{"query":"foo"}'` or `--params-file params.json` on the CLI
- Use `await pause(ctx.session)` (or `await pause(session)`) to pause the workflow for debugging. It is a no-op in production.
- After validation is complete and the workflow is confirmed working end to end, remove all `pause()` calls and pause-only workflow params unless the user explicitly says to keep them.
- The browser is launched and closed automatically by the CLI. Do not launch or close it in the handler.

## Uploading Artifacts with Context Storage

Use `ctx.storage` when a workflow needs to upload artifacts from standalone,
deployable workflow code. Pass temporary storage access as part of the workflow
input, then hand that access object to the storage helper:

```typescript
import { type GcpTemporaryStorageAccess } from "libretto";

type Input = {
  storageAccess?: GcpTemporaryStorageAccess;
};

export const myWorkflow = workflow<Input, Output>(
  "myWorkflow",
  async (ctx, input) => {
    if (input.storageAccess) {
      await ctx.storage.uploadJson({
        storageAccess: input.storageAccess,
        fileName: "artifacts/result.json",
        payload: { ok: true },
      });
    }
  },
);
```

This keeps the workflow deployable because the workflow only receives
serializable input. Do not rely on injected live service objects such as DB
clients or caches inside workflow context.

## Playwright DOM Interaction Rules

Generated code must use Playwright locator APIs for all DOM interactions. Do not use `page.evaluate()` with `document.querySelector`, `querySelectorAll`, `textContent`, `click()`, or other DOM APIs when a Playwright locator can do the same thing.

During the interactive `exec` phase, `page.evaluate` is fine for quick prototyping. In generated production code, translate those patterns into Playwright locators.

Before extracting data (for example text, rows, or field values), wait for the target content itself to be ready, not just its container.

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
