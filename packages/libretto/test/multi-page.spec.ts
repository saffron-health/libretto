import { describe, expect } from "vitest";
import { test } from "./fixtures";

describe("multi-page CLI behavior", () => {
  test("pages lists open pages with ids and urls", async ({ librettoCli }) => {
    const session = "multi-page-pages-command";
    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.stdout).toContain("Browser open");
    expect(opened.stdout).toContain("example.com");

    const singlePageResult = await librettoCli(`pages --session ${session}`);
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
    expect(result.stderr).toContain(
      `Multiple pages are open in session "${session}".`,
    );
    expect(result.stderr).toContain("Pass --page <id> to target a page");
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
    expect(execResult.stderr).toContain(`libretto pages --session ${session}`);

  }, 45_000);
});
