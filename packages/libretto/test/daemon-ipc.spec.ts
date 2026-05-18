import { writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { describe, expect } from "vitest";
import { test } from "./fixtures.js";

/**
 * Helper: write a minimal HTML fixture and return its file:// URL.
 * Using local files eliminates network-dependent flakiness from tests
 * that would otherwise hit https://example.com.
 */
async function writeFixturePage(
  workspacePath: (...segments: string[]) => string,
  name: string,
  title = "Test Page",
  body = "<h1>Hello</h1>",
): Promise<string> {
  const dir = workspacePath("fixtures");
  await mkdir(dir, { recursive: true });
  const htmlPath = workspacePath("fixtures", `${name}.html`);
  await writeFile(
    htmlPath,
    `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`,
    "utf8",
  );
  return pathToFileURL(htmlPath).href;
}

describe("daemon IPC", () => {
  test("pages returns page list through daemon IPC", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-pages";
    const url = await writeFixturePage(workspacePath, "pages", "Pages Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const pages = await librettoCli(`pages --session ${session}`);
    expect(pages.stdout).toContain("pages.html");
  }, 45_000);

  test("close reports Browser closed for a daemon-backed local session", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-close";
    const url = await writeFixturePage(workspacePath, "close", "Close Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const close = await librettoCli(`close --session ${session}`);
    expect(close.stdout).toContain(`Browser closed (session: ${session}).`);
  }, 45_000);

  test("exec returns values through daemon IPC", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec";
    const url = await writeFixturePage(workspacePath, "exec", "Exec Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec "await page.title()" --session ${session}`,
    );
    expect(result.stdout).toContain("Exec Test");
  }, 45_000);

  test("exec prints console output through daemon IPC", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-console";
    const url = await writeFixturePage(workspacePath, "exec-console");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec "console.log('hello from exec')" --session ${session}`,
    );
    expect(result.stdout).toContain("hello from exec");
  }, 45_000);

  test("exec prints console output before errors through daemon IPC", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-console-error";
    const url = await writeFixturePage(workspacePath, "exec-console-error");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec "console.log('before exec error'); throw new Error('expected exec failure')" --session ${session}`,
    );
    expect(result.stdout).toContain("before exec error");
    expect(result.stderr).toContain("expected exec failure");
  }, 45_000);

  test("exec persists bindings across calls", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-bindings";
    const url = await writeFixturePage(workspacePath, "bindings", "Binding Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    await librettoCli(`exec "let x = 42" --session ${session}`);

    const result = await librettoCli(
      `exec "x" --session ${session}`,
    );
    expect(result.stdout).toContain("42");
  }, 45_000);

  test("exec persists helper declarations across calls", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-helpers";
    const url = await writeFixturePage(workspacePath, "helpers", "Helper Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    await librettoCli(
      `exec - --session ${session}`,
      undefined,
      `async function pageTitleWithPrefix(prefix: string): Promise<string> {
  return prefix + await page.title();
}
`,
    );

    const result = await librettoCli(
      `exec "await pageTitleWithPrefix('title: ')" --session ${session}`,
    );
    expect(result.stdout).toContain("title: Helper Test");
  }, 45_000);

  test("exec exposes the current page main frame", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-frame-helper";
    const url = await writeFixturePage(
      workspacePath,
      "frame-helper",
      "Frame Helper Test",
      "<h1>Frame Heading</h1>",
    );
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec "await frame.locator('h1').textContent()" --session ${session}`,
    );
    expect(result.stdout).toContain("Frame Heading");
  }, 45_000);

  test("exec stdin waits for every complete statement before resolving", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-stdin-all-statements";
    const url = await writeFixturePage(
      workspacePath,
      "stdin-all-statements",
      "Multi Statement Test",
    );
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec - --session ${session}`,
      undefined,
      `console.log('first statement');
console.log('second statement');
await page.title();
`,
    );
    expect(result.stdout).toContain("first statement");
    expect(result.stdout).toContain("second statement");
    expect(result.stdout).toContain("Multi Statement Test");
  }, 45_000);

  test("exec stdin reports errors after earlier complete statements", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-stdin-late-error";
    const url = await writeFixturePage(
      workspacePath,
      "stdin-late-error",
      "Late Error Test",
    );
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec - --session ${session}`,
      undefined,
      `console.log('before late error');
throw new Error('expected late exec failure');
`,
    );
    expect(result.stdout).toContain("before late error");
    expect(result.stderr).toContain("expected late exec failure");
  }, 45_000);

  test("exec rejects top-level return with REPL-style guidance", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-top-level-return";
    const url = await writeFixturePage(
      workspacePath,
      "top-level-return",
      "Return Test",
    );
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec "return await page.title()" --session ${session}`,
    );
    expect(result.stderr).toContain("Return statement is not allowed here");
    expect(result.stderr).toContain("Hint: top-level return isn't supported");
    expect(result.stderr).toContain("exec is a REPL-style environment");
    expect(result.stderr).toContain("await page.title()");
  }, 45_000);

  test("exec reports JavaScript syntax errors", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-js-syntax-error";
    const url = await writeFixturePage(
      workspacePath,
      "js-syntax-error",
      "JavaScript Syntax Error Test",
    );
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec "const value = ;" --session ${session}`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Expression expected");
  }, 45_000);

  test("exec reports TypeScript syntax errors", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-ts-syntax-error";
    const url = await writeFixturePage(
      workspacePath,
      "ts-syntax-error",
      "TypeScript Syntax Error Test",
    );
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec - --session ${session}`,
      undefined,
      `function broken(value: string {
  return value;
}
`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Expected ',', got '{'");
  }, 45_000);

  test("readonly-exec works through daemon IPC", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-readonly";
    const url = await writeFixturePage(
      workspacePath,
      "readonly",
      "Readonly Test",
    );
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `readonly-exec "return page.url()" --session ${session}`,
    );
    expect(result.stdout).toContain("readonly.html");
  }, 45_000);

  test("readonly-exec prints console output through daemon IPC", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-readonly-console";
    const url = await writeFixturePage(workspacePath, "readonly-console");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `readonly-exec "console.log('hello from readonly')" --session ${session}`,
    );
    expect(result.stdout).toContain("hello from readonly");
  }, 45_000);

  test("readonly-exec prints console output before errors through daemon IPC", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-readonly-console-error";
    const url = await writeFixturePage(
      workspacePath,
      "readonly-console-error",
    );
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `readonly-exec "console.warn('before readonly error'); throw new Error('expected readonly failure')" --session ${session}`,
    );
    expect(result.stderr).toContain("before readonly error");
    expect(result.stderr).toContain("expected readonly failure");
  }, 45_000);

  test("compact snapshot prints screenshot path, tree, and subtree hint", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-compact-snapshot";
    const url = await writeFixturePage(
      workspacePath,
      "compact-snapshot",
      "Compact Snapshot Test",
      `<main><h1>Compact Heading</h1><button>Save Changes</button></main>`,
    );

    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(`snapshot --session ${session}`);
    expect(result.stdout).toContain("Screenshot at ");
    expect(result.stdout.indexOf("Screenshot at ")).toBeLessThan(
      result.stdout.indexOf("<page"),
    );
    expect(result.stdout).toContain("<page");
    expect(result.stdout).toContain("# Compact Heading");
    expect(result.stdout).toContain("Save Changes");
    expect(result.stdout).toContain("Hint: Use ");
    expect(result.stdout).toContain("snapshot <ref> --session");
  }, 45_000);

  test("experimental search prints matching HTML context", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-search";
    const url = await writeFixturePage(
      workspacePath,
      "search",
      "Search Test",
      [
        "<main>",
        "<h1>Search Heading</h1>",
        '<section data-testid="billing-card">',
        "<p>Invoice total is ready</p>",
        "</section>",
        "</main>",
      ].join(""),
    );
    await librettoCli("experiments enable search");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `search "billing-card|Invoice total" --session ${session}`,
    );

    expect(result.stdout).toContain('data-testid="billing-card"');
    expect(result.stdout).toContain("Invoice total is ready");
    expect(result.stdout).not.toContain("Lines ");
    expect(result.stderr).toBe("");
  }, 45_000);

  test("compact snapshot ref uses cached full snapshot and scopes output", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-compact-snapshot-ref";
    const url = await writeFixturePage(
      workspacePath,
      "compact-snapshot-ref",
      "Compact Snapshot Ref Test",
      `<main><h1>Scoped Page</h1><p>Sibling Details</p><button>Save Changes</button></main>`,
    );

    await librettoCli(`open "${url}" --headless --session ${session}`);

    const fullSnapshot = await librettoCli(`snapshot --session ${session}`);
    const ref = fullSnapshot.stdout.match(/<button ref="([^"]+)"/)?.[1];
    expect(ref).toBeTruthy();

    const scopedSnapshot = await librettoCli(
      `snapshot ${ref} --session ${session}`,
    );
    expect(scopedSnapshot.stdout).toContain("Screenshot at ");
    expect(scopedSnapshot.stdout).toContain("Save Changes");
    expect(scopedSnapshot.stdout).not.toContain("Sibling Details");
  }, 45_000);

  test("compact snapshot refs only reuse cache for the same page", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-compact-snapshot-page-cache";
    const firstUrl = await writeFixturePage(
      workspacePath,
      "compact-snapshot-page-cache-first",
      "Compact Snapshot First Page",
      `<main><button>First Page Button</button></main>`,
    );
    const secondUrl = await writeFixturePage(
      workspacePath,
      "compact-snapshot-page-cache-second",
      "Compact Snapshot Second Page",
      `<main><button>Second Page Button</button></main>`,
    );

    await librettoCli(`open "${firstUrl}" --headless --session ${session}`);
    await librettoCli(
      `exec "const p = await context.newPage(); await p.goto('${secondUrl}')" --session ${session}`,
    );

    const pages = await librettoCli(`pages --session ${session}`);
    const firstPageId = pages.stdout
      .split("\n")
      .find((line) => line.includes("compact-snapshot-page-cache-first"))
      ?.match(/id=(\S+)/)?.[1];
    const secondPageId = pages.stdout
      .split("\n")
      .find((line) => line.includes("compact-snapshot-page-cache-second"))
      ?.match(/id=(\S+)/)?.[1];
    expect(firstPageId).toBeTruthy();
    expect(secondPageId).toBeTruthy();

    const firstSnapshot = await librettoCli(
      `snapshot --session ${session} --page ${firstPageId}`,
    );
    const ref = firstSnapshot.stdout.match(/<button ref="([^"]+)"/)?.[1];
    expect(ref).toBeTruthy();

    const secondScopedSnapshot = await librettoCli(
      `snapshot ${ref} --session ${session} --page ${secondPageId}`,
    );
    expect(secondScopedSnapshot.stderr).toContain("No compact snapshot is cached");
  }, 45_000);

  test("compact snapshot ref fails before a full compact snapshot is cached", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-compact-snapshot-ref-missing";
    const url = await writeFixturePage(
      workspacePath,
      "compact-snapshot-ref-missing",
      "Compact Snapshot Missing Ref Cache Test",
      `<main><button>Save Changes</button></main>`,
    );

    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(`snapshot l1 --session ${session}`);
    expect(result.stderr).toContain("No compact snapshot is cached");
    expect(result.stderr).toContain(`snapshot --session ${session}`);
  }, 45_000);

  test("compact exec diff uses the snapshot cache as its before state", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-compact-exec-cached-diff";
    const url = await writeFixturePage(
      workspacePath,
      "compact-exec-cached-diff",
      "Compact Exec Cached Diff Test",
      `<main><h1>Before Heading</h1><button>Save Changes</button></main>`,
    );

    await librettoCli(`open "${url}" --headless --session ${session}`);

    const beforeSnapshot = await librettoCli(`snapshot --session ${session}`);
    expect(beforeSnapshot.stdout).toContain("Before Heading");

    const result = await librettoCli(
      `exec "await page.locator('h1').evaluate((node) => { node.textContent = 'After Heading'; })" --session ${session}`,
    );
    expect(result.stdout).toContain("Executed successfully");
    expect(result.stdout).toContain("Page changes:");
    expect(result.stdout).toContain("Before Heading");
    expect(result.stdout).toContain("After Heading");
  }, 45_000);

  test("compact exec diff captures a before state when no snapshot is cached", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-compact-exec-fresh-diff";
    const url = await writeFixturePage(
      workspacePath,
      "compact-exec-fresh-diff",
      "Compact Exec Fresh Diff Test",
      `<main><h1>Stable Heading</h1></main>`,
    );

    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec "await page.locator('main').evaluate((node) => node.insertAdjacentHTML('beforeend', '<p>New Content</p>'))" --session ${session}`,
    );
    expect(result.stdout).toContain("Executed successfully");
    expect(result.stdout).toContain("Page changes:");
    expect(result.stdout).toContain("New Content");
  }, 45_000);

  test("compact exec preserves successful results when diff capture fails", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-compact-exec-diff-fails";
    const url = await writeFixturePage(
      workspacePath,
      "compact-exec-diff-fails",
      "Compact Exec Diff Fails Test",
      `<main><h1>Closing Page</h1></main>`,
    );

    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec "await page.close(), 'closed ok'" --session ${session}`,
    );
    expect(result.stdout).toContain("closed ok");
    expect(result.stdout).not.toContain("Page changes:");
    expect(result.stderr).not.toContain("Target page, context or browser has been closed");
  }, 45_000);

  test("readonly-exec does not print page changes or invalidate the snapshot cache", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-compact-readonly-cache";
    const url = await writeFixturePage(
      workspacePath,
      "compact-readonly-cache",
      "Compact Readonly Cache Test",
      `<main><h1>Readonly Heading</h1><button>Cache Target</button></main>`,
    );

    await librettoCli(`open "${url}" --headless --session ${session}`);

    const fullSnapshot = await librettoCli(`snapshot --session ${session}`);
    const ref = fullSnapshot.stdout.match(/<button ref="([^"]+)"/)?.[1];
    expect(ref).toBeTruthy();

    const readonly = await librettoCli(
      `readonly-exec "return await page.locator('h1').textContent()" --session ${session}`,
    );
    expect(readonly.stdout).toContain("Readonly Heading");
    expect(readonly.stdout).not.toContain("Page changes:");

    const scopedSnapshot = await librettoCli(
      `snapshot ${ref} --session ${session}`,
    );
    expect(scopedSnapshot.stdout).toContain("Cache Target");
  }, 45_000);

  test("exec without --page targets the original page after a workflow opens another page", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "daemon-primary-page-exec";
    const integrationFilePath = await writeWorkflow(
      "integration-primary-page-exec.mjs",
      `
export default workflow("main", async ({ page }) => {
  await page.goto("data:text/html,<title>Original Primary Page</title>");
  const popup = await page.context().newPage();
  await popup.goto("data:text/html,<title>Secondary Debug Page</title>");
});
`,
    );

    const run = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless --stay-open-on-success`,
    );
    expect(run.stdout).toContain("Integration completed.");

    const result = await librettoCli(
      `exec "await page.title()" --session ${session}`,
    );
    expect(result.stdout).toContain("Original Primary Page");
    expect(result.stdout).not.toContain("Secondary Debug Page");
  }, 45_000);

  test("readonly-exec without --page targets the original page after a workflow opens another page", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "daemon-primary-page-readonly";
    const integrationFilePath = await writeWorkflow(
      "integration-primary-page-readonly.mjs",
      `
export default workflow("main", async ({ page }) => {
  await page.goto("data:text/html,<title>Readonly Primary Page</title>");
  const popup = await page.context().newPage();
  await popup.goto("data:text/html,<title>Readonly Secondary Page</title>");
});
`,
    );

    const run = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless --stay-open-on-success`,
    );
    expect(run.stdout).toContain("Integration completed.");

    const result = await librettoCli(
      `readonly-exec "return page.url()" --session ${session}`,
    );
    expect(result.stdout).toContain("Readonly Primary Page");
    expect(result.stdout).not.toContain("Readonly Secondary Page");
  }, 45_000);

  test("exec without --page falls back to the remaining page when the original page is closed", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "daemon-primary-page-closed";
    const integrationFilePath = await writeWorkflow(
      "integration-primary-page-closed.mjs",
      `
export default workflow("main", async ({ page }) => {
  const replacement = await page.context().newPage();
  await replacement.goto("data:text/html,<title>Replacement Page</title>");
  await page.close();
});
`,
    );

    const run = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless --stay-open-on-success`,
    );
    expect(run.stdout).toContain("Integration completed.");

    const result = await librettoCli(
      `exec "await page.title()" --session ${session}`,
    );
    expect(result.stdout).toContain("Replacement Page");
  }, 45_000);

  test("run --stay-open-on-success leaves a daemon-backed session for pages and snapshot", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "daemon-run-stay-open";
    const integrationFilePath = await writeWorkflow(
      "integration-daemon-run-stay-open.mjs",
      `
export default workflow("main", async ({ page }) => {
  await page.goto("data:text/html,<title>Daemon Run Stay Open</title><h1>ready</h1>");
  console.log("DAEMON_RUN_STAY_OPEN_READY");
});
`,
    );

    const run = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless --stay-open-on-success`,
    );
    expect(run.stdout).toContain("DAEMON_RUN_STAY_OPEN_READY");
    expect(run.stdout).toContain("Integration completed.");
    expect(run.stdout).toContain("Browser is still open");

    const pages = await librettoCli(`pages --session ${session}`);
    expect(pages.stdout).toContain("Open pages:");
    expect(pages.stdout).toContain("Daemon Run Stay Open");
    expect(pages.stderr).not.toContain("daemon socket");

    const snapshot = await librettoCli(`snapshot --session ${session}`);
    expect(snapshot.stderr).not.toContain("daemon socket");
    expect(snapshot.stderr).not.toContain("daemon may have crashed");
  }, 45_000);

  test("failed run leaves a daemon-backed session for pages and snapshot", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "daemon-run-failure";
    const integrationFilePath = await writeWorkflow(
      "integration-daemon-run-failure.mjs",
      `
export default workflow("main", async ({ page }) => {
  await page.goto("data:text/html,<title>Daemon Run Failure</title><h1>failure target</h1>");
  console.log("DAEMON_RUN_FAILURE_READY");
  throw new Error("expected daemon run failure");
});
`,
    );

    const run = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless`,
    );
    expect(run.stdout).toContain("DAEMON_RUN_FAILURE_READY");
    expect(run.stderr).toContain("expected daemon run failure");
    expect(run.stderr).toContain("Browser is still open.");

    const pages = await librettoCli(`pages --session ${session}`);
    expect(pages.stdout).toContain("Open pages:");
    expect(pages.stdout).toContain("Daemon Run Failure");
    expect(pages.stderr).not.toContain("daemon socket");

    const snapshot = await librettoCli(`snapshot --session ${session}`);
    expect(snapshot.stderr).not.toContain("daemon socket");
    expect(snapshot.stderr).not.toContain("daemon may have crashed");
  }, 45_000);

  test("exec preserves aria refs generated by a previous exec", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-aria-ref";
    const url = await writeFixturePage(
      workspacePath,
      "exec-aria-ref",
      "Exec Aria Ref Test",
      `<button>Click target</button>`,
    );
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const snapshot = await librettoCli(
      `exec "(await page._snapshotForAI({ track: 'response' })).full" --session ${session}`,
    );
    expect(snapshot.stdout).toContain("Click target");
    expect(snapshot.stdout).toContain("ref=e2");

    const result = await librettoCli(
      `exec "await page.locator('aria-ref=e2').textContent()" --session ${session}`,
    );
    expect(result.stdout).toContain("Click target");
  }, 45_000);
});
