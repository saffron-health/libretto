import { describe, expect } from "vitest";
import { test } from "./fixtures";

type PageListEntry = {
  id: string;
  url: string;
};

function parsePagesOutput(output: string): PageListEntry[] {
  const entries: PageListEntry[] = [];
  const lineRegex = /id=([a-zA-Z0-9._-]+)\s+url=(\S+)/g;
  let match: RegExpExecArray | null = null;
  while ((match = lineRegex.exec(output)) !== null) {
    entries.push({ id: match[1]!, url: match[2]! });
  }
  return entries;
}

describe("multi-page CLI behavior", () => {
  test("pages lists open pages with id and url", async ({
    librettoCli,
  }) => {
    const session = "multi-page-pages-command";
    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.exitCode).toBe(0);

    try {
      const singlePageResult = await librettoCli(`pages --session ${session}`);
      expect(singlePageResult.exitCode).toBe(0);
      const singlePage = parsePagesOutput(singlePageResult.stdout);
      expect(singlePage.length).toBeGreaterThan(0);
      expect(singlePage.length).toBe(1);
      expect(singlePage[0]?.url).toContain("example.com");

      const secondPageResult = await librettoCli(
        `exec "const p = await context.newPage(); await p.goto('data:text/html,multi-page-secondary'); return context.pages().length;" --session ${session}`,
      );
      expect(secondPageResult.exitCode).toBe(0);

      const multiplePagesResult = await librettoCli(`pages --session ${session}`);
      expect(multiplePagesResult.exitCode).toBe(0);
      const multiplePages = parsePagesOutput(multiplePagesResult.stdout);
      expect(multiplePages.length).toBeGreaterThan(0);
      expect(multiplePages.length).toBeGreaterThanOrEqual(2);
      expect(
        multiplePages.some((entry) => entry.url.includes("example.com")),
      ).toBe(true);
      expect(
        multiplePages.some((entry) =>
          entry.url.includes("multi-page-secondary"),
        ),
      ).toBe(true);
    } finally {
      await librettoCli(`close --session ${session}`);
    }
  }, 45_000);

  test("exec requires --page when multiple pages are open", async ({
    librettoCli,
  }) => {
    const session = "multi-page-exec-requires-page";
    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.exitCode).toBe(0);

    try {
      const secondPageResult = await librettoCli(
        `exec "const p = await context.newPage(); await p.goto('data:text/html,multi-page-secondary'); return context.pages().length;" --session ${session}`,
      );
      expect(secondPageResult.exitCode).toBe(0);

      const result = await librettoCli(
        `exec "return await page.url()" --session ${session}`,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Multiple pages are open");
      expect(result.stderr).toContain("--page");
    } finally {
      await librettoCli(`close --session ${session}`);
    }
  }, 45_000);

  test("exec --page targets the requested page id", async ({
    librettoCli,
  }) => {
    const session = "multi-page-exec-targeting";
    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.exitCode).toBe(0);

    try {
      const secondPageResult = await librettoCli(
        `exec "const p = await context.newPage(); await p.goto('data:text/html,multi-page-secondary'); return context.pages().length;" --session ${session}`,
      );
      expect(secondPageResult.exitCode).toBe(0);

      const pagesResult = await librettoCli(`pages --session ${session}`);
      expect(pagesResult.exitCode).toBe(0);
      const pages = parsePagesOutput(pagesResult.stdout);
      expect(pages.length).toBeGreaterThan(0);
      const examplePage = pages.find((pageEntry) =>
        pageEntry.url.includes("example.com"),
      );

      expect(examplePage).toBeDefined();
      expect(examplePage?.id).toMatch(/^[a-zA-Z0-9._-]+$/);

      const result = await librettoCli(
        `exec "return await page.url()" --page ${examplePage?.id} --session ${session}`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("example.com");
    } finally {
      await librettoCli(`close --session ${session}`);
    }
  }, 45_000);

  test("snapshot requires --page when multiple pages are open", async ({
    librettoCli,
  }) => {
    const session = "multi-page-snapshot-requires-page";
    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.exitCode).toBe(0);

    try {
      const secondPageResult = await librettoCli(
        `exec "const p = await context.newPage(); await p.goto('data:text/html,multi-page-secondary'); return context.pages().length;" --session ${session}`,
      );
      expect(secondPageResult.exitCode).toBe(0);

      const snapshot = await librettoCli(`snapshot --session ${session}`);
      expect(snapshot.exitCode).toBe(1);
      expect(snapshot.stderr).toContain("Multiple pages are open");
      expect(snapshot.stderr).toContain("--page");
    } finally {
      await librettoCli(`close --session ${session}`);
    }
  }, 45_000);

  test("actions and network commands filter correctly by page id", async ({
    librettoCli,
  }) => {
    const session = "multi-page-log-page-id";
    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.exitCode).toBe(0);

    try {
      const secondPageOpened = await librettoCli(
        `exec "const p = await context.newPage(); await p.goto('https://example.org'); return context.pages().length;" --session ${session}`,
      );
      expect(secondPageOpened.exitCode).toBe(0);

      const pagesResult = await librettoCli(`pages --session ${session}`);
      expect(pagesResult.exitCode).toBe(0);
      const pages = parsePagesOutput(pagesResult.stdout);
      expect(pages.length).toBeGreaterThan(0);
      const exampleComPage = pages.find((entry) =>
        entry.url.includes("example.com"),
      );
      const exampleOrgPage = pages.find((entry) =>
        entry.url.includes("example.org"),
      );
      expect(exampleComPage).toBeDefined();
      expect(exampleOrgPage).toBeDefined();

      const reloadCom = await librettoCli(
        `exec "await page.reload(); return await page.url();" --page ${exampleComPage?.id} --session ${session}`,
      );
      expect(reloadCom.exitCode).toBe(0);

      const reloadOrg = await librettoCli(
        `exec "await page.reload(); return await page.url();" --page ${exampleOrgPage?.id} --session ${session}`,
      );
      expect(reloadOrg.exitCode).toBe(0);

      const actionsCom = await librettoCli(
        `actions --session ${session} --page ${exampleComPage?.id} --last 20`,
      );
      expect(actionsCom.exitCode).toBe(0);
      expect(actionsCom.stdout).toContain("action(s) shown.");
      expect(actionsCom.stdout).toContain("example.com");
      expect(actionsCom.stdout).not.toContain("example.org");

      const actionsOrg = await librettoCli(
        `actions --session ${session} --page ${exampleOrgPage?.id} --last 20`,
      );
      expect(actionsOrg.exitCode).toBe(0);
      expect(actionsOrg.stdout).toContain("action(s) shown.");
      expect(actionsOrg.stdout).toContain("example.org");
      expect(actionsOrg.stdout).not.toContain("example.com");

      const networkCom = await librettoCli(
        `network --session ${session} --page ${exampleComPage?.id} --last 20`,
      );
      expect(networkCom.exitCode).toBe(0);
      expect(networkCom.stdout).toContain("request(s) shown.");
      expect(networkCom.stdout).toContain("example.com");
      expect(networkCom.stdout).not.toContain("example.org");

      const networkOrg = await librettoCli(
        `network --session ${session} --page ${exampleOrgPage?.id} --last 20`,
      );
      expect(networkOrg.exitCode).toBe(0);
      expect(networkOrg.stdout).toContain("request(s) shown.");
      expect(networkOrg.stdout).toContain("example.org");
      expect(networkOrg.stdout).not.toContain("example.com");
    } finally {
      await librettoCli(`close --session ${session}`);
    }
  }, 60_000);
});
