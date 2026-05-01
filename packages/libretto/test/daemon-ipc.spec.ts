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

  test("exec returns values through daemon IPC", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec";
    const url = await writeFixturePage(workspacePath, "exec", "Exec Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec "return await page.title()" --session ${session}`,
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

  test("exec persists state across calls", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-state";
    const url = await writeFixturePage(workspacePath, "state", "State Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    await librettoCli(`exec "state.x = 42" --session ${session}`);

    const result = await librettoCli(
      `exec "return state.x" --session ${session}`,
    );
    expect(result.stdout).toContain("42");
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

  test("snapshot through daemon IPC fails at analysis, not at daemon layer", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-snapshot";
    const url = await writeFixturePage(
      workspacePath,
      "snapshot",
      "Snapshot Test",
    );
    await librettoCli(`open "${url}" --headless --session ${session}`);

    // Without valid AI credentials the command fails at model
    // validation or analysis — not at the daemon/IPC layer. Verify
    // the error is NOT a daemon connection failure.
    const result = await librettoCli(
      `snapshot --session ${session} --objective "test" --context "test"`,
    );
    expect(result.stderr).not.toContain("daemon socket");
    expect(result.stderr).not.toContain("daemon may have crashed");
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

    const snapshot = await librettoCli(
      `snapshot --session ${session} --objective "Find the heading" --context "Daemon-backed run session"`,
    );
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

    const snapshot = await librettoCli(
      `snapshot --session ${session} --objective "Find the heading" --context "Daemon-backed failed run session"`,
    );
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
      `exec "return (await page._snapshotForAI({ track: 'response' })).full" --session ${session}`,
    );
    expect(snapshot.stdout).toContain("Click target");
    expect(snapshot.stdout).toContain("ref=e2");

    const result = await librettoCli(
      `exec "return await page.locator('aria-ref=e2').textContent()" --session ${session}`,
    );
    expect(result.stdout).toContain("Click target");
  }, 45_000);
});
