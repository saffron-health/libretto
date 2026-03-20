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
    const singlePageLines = singlePageResult.stdout.trimEnd().split("\n");
    expect(singlePageLines[0]).toBe("Open pages:");
    expect(singlePageLines[1]).toMatch(
      /^  id=[^\s]+ url=https:\/\/example\.com\/? active=true$/,
    );
    expect(singlePageLines).toHaveLength(2);

    await librettoCli(
      `exec "const p = await context.newPage(); await p.goto('data:text/html,multi-page-secondary'); return context.pages().length;" --session ${session}`,
    );

    const multiplePagesResult = await librettoCli(`pages --session ${session}`);
    await evaluate(multiplePagesResult.stdout).toMatch(
      "Lists both the example.com page and the data:text/html,multi-page-secondary page, each with page ids.",
    );
    const multiplePageLines = multiplePagesResult.stdout.trimEnd().split("\n");
    expect(multiplePageLines[0]).toBe("Open pages:");
    expect(multiplePageLines).toHaveLength(3);
    expect(
      multiplePageLines
        .slice(1)
        .every((line) => /^  id=[^\s]+ url=/.test(line)),
    ).toBe(true);
    expect(
      multiplePageLines.some((line) =>
        /^  id=[^\s]+ url=https:\/\/example\.com\/?( active=(true|false))?$/.test(
          line,
        ),
      ),
    ).toBe(true);
    expect(
      multiplePageLines.some((line) =>
        /^  id=[^\s]+ url=data:text\/html,multi-page-secondary( active=(true|false))?$/.test(
          line,
        ),
      ),
    ).toBe(true);
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
