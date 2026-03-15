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
    expect(singlePageResult.stdout).toContain("url=https://example.com/");
    expect(singlePageResult.stdout).toMatch(/id=[^\s]+/);

    await librettoCli(
      `exec "const p = await context.newPage(); await p.goto('data:text/html,multi-page-secondary'); return context.pages().length;" --session ${session}`,
    );

    const multiplePagesResult = await librettoCli(`pages --session ${session}`);
    expect(multiplePagesResult.stdout).toContain("url=https://example.com/");
    expect(multiplePagesResult.stdout).toContain("url=data:text/html,multi-page-secondary");
    expect(multiplePagesResult.stdout.match(/id=[^\s]+/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  }, 45_000);

  test("exec requires --page when multiple pages are open", async ({
    librettoCli,
    evaluate,
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
    await evaluate(result.stderr).toMatch(
      "Explains multiple pages are open and requires passing --page.",
    );
  }, 45_000);

  test("snapshot requires --page when multiple pages are open", async ({
    librettoCli,
    evaluate,
  }) => {
    const session = "multi-page-snapshot-requires-page";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    await librettoCli(
      `exec "const p = await context.newPage(); await p.goto('data:text/html,multi-page-secondary'); return context.pages().length;" --session ${session}`,
    );

    const snapshot = await librettoCli(`snapshot --session ${session}`);
    await evaluate(snapshot.stderr).toMatch(
      "Explains multiple pages are open and requires passing --page.",
    );
  }, 45_000);

  test("commands fail with a clear error for unknown page ids", async ({
    librettoCli,
    evaluate,
  }) => {
    const session = "multi-page-invalid-page-id";
    const missingPageId = "MISSING_PAGE_ID_FOR_TEST";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const execResult = await librettoCli(
      `exec "return page.url()" --session ${session} --page ${missingPageId}`,
    );
    await evaluate(execResult.stderr).toMatch(
      `Says page id ${missingPageId} was not found for this session.`,
    );

    const snapshotResult = await librettoCli(
      `snapshot --session ${session} --page ${missingPageId}`,
    );
    await evaluate(snapshotResult.stderr).toMatch(
      `Says page id ${missingPageId} was not found for this session.`,
    );

    const actionsResult = await librettoCli(
      `actions --session ${session} --page ${missingPageId}`,
    );
    await evaluate(actionsResult.stderr).toMatch(
      `Says page id ${missingPageId} was not found for this session.`,
    );

    const networkResult = await librettoCli(
      `network --session ${session} --page ${missingPageId}`,
    );
    await evaluate(networkResult.stderr).toMatch(
      `Says page id ${missingPageId} was not found for this session.`,
    );
  }, 45_000);
});
