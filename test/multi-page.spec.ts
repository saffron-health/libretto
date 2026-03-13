import { describe, expect } from "vitest";
import { test } from "./fixtures";

describe("multi-page CLI behavior", () => {
  test("pages lists open pages with ids and urls", async ({
    librettoCli,
    evaluate,
  }) => {
    const session = "multi-page-pages-command";
    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    await evaluate(opened.stdout).toMatch(
      `Confirms the browser opened successfully for example.com in session "${session}".`,
    );

    const singlePageResult = await librettoCli(`pages --session ${session}`);
    await evaluate(singlePageResult.stdout).toMatch(
      "Lists one open page for example.com and includes its page id.",
    );
    expect(singlePageResult.stdout).toMatch(/id=[^\s]+ url=https:\/\/example\.com\/?/);

    await librettoCli(
      `exec "const p = await context.newPage(); await p.goto('data:text/html,multi-page-secondary'); return context.pages().length;" --session ${session}`,
    );

    const multiplePagesResult = await librettoCli(`pages --session ${session}`);
    await evaluate(multiplePagesResult.stdout).toMatch(
      "Lists both the example.com page and the data:text/html,multi-page-secondary page, each with page ids.",
    );
    expect(multiplePagesResult.stdout).toMatch(/id=[^\s]+ url=/);
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
      `Explains that multiple pages are open in session "${session}" and tells the user to pass --page <id> to target one page.`,
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
      `Explains that multiple pages are open in session "${session}" and tells the user to pass --page <id> to target one page.`,
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
      `Explains that page id "${missingPageId}" was not found in session "${session}".`,
    );

    const snapshotResult = await librettoCli(
      `snapshot --session ${session} --page ${missingPageId}`,
    );
    await evaluate(snapshotResult.stderr).toMatch(
      `Explains that page id "${missingPageId}" was not found in session "${session}".`,
    );

    const actionsResult = await librettoCli(
      `actions --session ${session} --page ${missingPageId}`,
    );
    await evaluate(actionsResult.stderr).toMatch(
      `Explains that page id "${missingPageId}" was not found in session "${session}".`,
    );

    const networkResult = await librettoCli(
      `network --session ${session} --page ${missingPageId}`,
    );
    await evaluate(networkResult.stderr).toMatch(
      `Explains that page id "${missingPageId}" was not found in session "${session}".`,
    );
  }, 45_000);
});
