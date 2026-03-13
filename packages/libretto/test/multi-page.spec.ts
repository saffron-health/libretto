import { describe, expect } from "vitest";
import { test } from "./fixtures";

describe("multi-page CLI behavior", () => {
  test("pages lists open pages with ids and urls", async ({
    librettoCli,
  }) => {
    const session = "multi-page-pages-command";
    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.stdout).toContain("Browser open");

    const singlePageResult = await librettoCli(`pages --session ${session}`);
    expect(singlePageResult.stdout).toContain("Open pages:");
    expect(singlePageResult.stdout).toContain("example.com");
    expect(singlePageResult.stdout).toMatch(/id=[^\s]+ url=https:\/\/example\.com\/?/);

    await librettoCli(
      `exec "const p = await context.newPage(); await p.goto('data:text/html,multi-page-secondary'); return context.pages().length;" --session ${session}`,
    );

    const multiplePagesResult = await librettoCli(`pages --session ${session}`);
    expect(multiplePagesResult.stdout).toContain("Open pages:");
    expect(multiplePagesResult.stdout).toContain("example.com");
    expect(multiplePagesResult.stdout).toContain("data:text/html,multi-page-secondary");
    expect(multiplePagesResult.stdout).toMatch(/id=[^\s]+ url=/);
  }, 45_000);

  test("exec requires --page when multiple pages are open", async ({
    librettoCli,
  }) => {
    const session = "multi-page-exec-requires-page";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    await librettoCli(
      `exec "const p = await context.newPage(); await p.goto('data:text/html,multi-page-secondary'); return context.pages().length;" --session ${session}`,
    );

    const result = await librettoCli(
      `exec "return await page.url()" --session ${session}`,
    );
    expect(result.stderr).toContain(`Multiple pages are open in session "${session}".`);
    expect(result.stderr).toContain("Pass --page <id> to target a page");
  }, 45_000);

  test("snapshot requires --page when multiple pages are open", async ({
    librettoCli,
  }) => {
    const session = "multi-page-snapshot-requires-page";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    await librettoCli(
      `exec "const p = await context.newPage(); await p.goto('data:text/html,multi-page-secondary'); return context.pages().length;" --session ${session}`,
    );

    const snapshot = await librettoCli(`snapshot --session ${session}`);
    expect(snapshot.stderr).toContain(`Multiple pages are open in session "${session}".`);
    expect(snapshot.stderr).toContain("Pass --page <id> to target a page");
  }, 45_000);

  test("commands fail with a clear error for unknown page ids", async ({
    librettoCli,
  }) => {
    const session = "multi-page-invalid-page-id";
    const missingPageId = "MISSING_PAGE_ID_FOR_TEST";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const execResult = await librettoCli(
      `exec "return page.url()" --session ${session} --page ${missingPageId}`,
    );
    expect(execResult.stderr).toContain(
      `Page "${missingPageId}" was not found in session "${session}".`,
    );

    const snapshotResult = await librettoCli(
      `snapshot --session ${session} --page ${missingPageId}`,
    );
    expect(snapshotResult.stderr).toContain(
      `Page "${missingPageId}" was not found in session "${session}".`,
    );

    const actionsResult = await librettoCli(
      `actions --session ${session} --page ${missingPageId}`,
    );
    expect(actionsResult.stderr).toContain(
      `Page "${missingPageId}" was not found in session "${session}".`,
    );

    const networkResult = await librettoCli(
      `network --session ${session} --page ${missingPageId}`,
    );
    expect(networkResult.stderr).toContain(
      `Page "${missingPageId}" was not found in session "${session}".`,
    );
  }, 45_000);
});
