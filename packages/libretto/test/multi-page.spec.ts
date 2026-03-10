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
      `open https://example.com/?tab=one --headless --session ${session}`,
    );
    expect(opened.exitCode).toBe(0);

    try {
      const secondPageOpened = await librettoCli(
        `exec "await page.evaluate(() => window.open('https://example.com/?tab=two', '_blank')); await page.waitForTimeout(1500); return context.pages().length;" --session ${session}`,
      );
      expect(secondPageOpened.exitCode).toBe(0);

      const pagesResult = await librettoCli(`pages --session ${session}`);
      expect(pagesResult.exitCode).toBe(0);
      const pages = parsePagesOutput(pagesResult.stdout);
      expect(pages.length).toBeGreaterThan(0);
      const exampleComPage = pages.find((entry) =>
        entry.url.includes("tab=one"),
      );
      const exampleOrgPage = pages.find((entry) =>
        entry.url.includes("tab=two"),
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
        `actions --session ${session} --page ${exampleComPage?.id} --action reload --last 20`,
      );
      expect(actionsCom.exitCode).toBe(0);
      expect(actionsCom.stdout).toContain("action(s) shown.");
      expect(actionsCom.stdout).toContain("tab=one");
      expect(actionsCom.stdout).not.toContain("tab=two");

      const actionsOrg = await librettoCli(
        `actions --session ${session} --page ${exampleOrgPage?.id} --action reload --last 20`,
      );
      expect(actionsOrg.exitCode).toBe(0);
      expect(actionsOrg.stdout).toContain("action(s) shown.");
      expect(actionsOrg.stdout).toContain("tab=two");
      expect(actionsOrg.stdout).not.toContain("tab=one");

      const networkCom = await librettoCli(
        `network --session ${session} --page ${exampleComPage?.id} --last 20`,
      );
      expect(networkCom.exitCode).toBe(0);
      expect(networkCom.stdout).toContain("request(s) shown.");
      expect(networkCom.stdout).toContain("tab=one");
      expect(networkCom.stdout).not.toContain("tab=two");

      const networkOrg = await librettoCli(
        `network --session ${session} --page ${exampleOrgPage?.id} --last 20`,
      );
      expect(networkOrg.exitCode).toBe(0);
      expect(networkOrg.stdout).toContain("request(s) shown.");
      expect(networkOrg.stdout).toContain("tab=two");
      expect(networkOrg.stdout).not.toContain("tab=one");
    } finally {
      await librettoCli(`close --session ${session}`);
    }
  }, 60_000);

  test.todo("network --page includes requests from context.newPage pages");

  test("commands fail with a clear error for unknown page ids", async ({
    librettoCli,
  }) => {
    const session = "multi-page-invalid-page-id";
    const missingPageId = "MISSING_PAGE_ID_FOR_TEST";
    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.exitCode).toBe(0);

    try {
      const execResult = await librettoCli(
        `exec "return page.url()" --session ${session} --page ${missingPageId}`,
      );
      expect(execResult.exitCode).toBe(1);
      expect(execResult.stderr).toContain(`Page "${missingPageId}" was not found`);

      const snapshotResult = await librettoCli(
        `snapshot --session ${session} --page ${missingPageId}`,
      );
      expect(snapshotResult.exitCode).toBe(1);
      expect(snapshotResult.stderr).toContain(`Page "${missingPageId}" was not found`);

      const actionsResult = await librettoCli(
        `actions --session ${session} --page ${missingPageId}`,
      );
      expect(actionsResult.exitCode).toBe(1);
      expect(actionsResult.stderr).toContain(`Page "${missingPageId}" was not found`);

      const networkResult = await librettoCli(
        `network --session ${session} --page ${missingPageId}`,
      );
      expect(networkResult.exitCode).toBe(1);
      expect(networkResult.stderr).toContain(`Page "${missingPageId}" was not found`);
    } finally {
      await librettoCli(`close --session ${session}`);
    }
  }, 45_000);

  test("closed page ids are rejected by page-targeted commands", async ({
    librettoCli,
  }) => {
    const session = "multi-page-closed-page-id";
    const opened = await librettoCli(
      `open https://example.com/?close=one --headless --session ${session}`,
    );
    expect(opened.exitCode).toBe(0);

    try {
      const secondPageOpened = await librettoCli(
        `exec "await page.evaluate(() => window.open('https://example.com/?close=two', '_blank')); await page.waitForTimeout(1500); return context.pages().length;" --session ${session}`,
      );
      expect(secondPageOpened.exitCode).toBe(0);

      const pagesBeforeClose = await librettoCli(`pages --session ${session}`);
      expect(pagesBeforeClose.exitCode).toBe(0);
      const entriesBeforeClose = parsePagesOutput(pagesBeforeClose.stdout);
      const closeTwoPage = entriesBeforeClose.find((entry) =>
        entry.url.includes("close=two"),
      );
      expect(closeTwoPage).toBeDefined();

      const closePageResult = await librettoCli(
        `exec "await page.close(); return 'closed';" --session ${session} --page ${closeTwoPage?.id}`,
      );
      expect(closePageResult.exitCode).toBe(0);

      const pagesAfterClose = await librettoCli(`pages --session ${session}`);
      expect(pagesAfterClose.exitCode).toBe(0);
      expect(pagesAfterClose.stdout).not.toContain(closeTwoPage?.id ?? "");

      const stalePageExec = await librettoCli(
        `exec "return page.url();" --session ${session} --page ${closeTwoPage?.id}`,
      );
      expect(stalePageExec.exitCode).toBe(1);
      expect(stalePageExec.stderr).toContain(
        `Page "${closeTwoPage?.id}" was not found`,
      );
    } finally {
      await librettoCli(`close --session ${session}`);
    }
  }, 60_000);

  test("run --debug supports page-scoped logs for multiple pages", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "multi-page-run-debug-page-logs";
    const integrationFilePath = await writeWorkflow(
      "integration-multi-page-debug.mjs",
      `
export const main = workflow({}, async (ctx) => {
  await ctx.page.goto("https://example.com/?run=one");
  await ctx.page.evaluate(() => window.open("https://example.com/?run=two", "_blank"));
  await ctx.page.waitForTimeout(1500);
  const secondPage = ctx.context.pages().find((p) => p.url().includes("run=two"));
  if (!secondPage) throw new Error("Second page was not opened");
  await secondPage.reload();
  await ctx.pause();
});
`,
      ["workflow"],
    );

    const runResult = await librettoCli(
      `run "${integrationFilePath}" main --session ${session} --headless --debug`,
    );
    expect(runResult.exitCode).toBe(0);
    expect(runResult.stdout).toContain("Workflow paused.");

    try {
      const pagesResult = await librettoCli(`pages --session ${session}`);
      expect(pagesResult.exitCode).toBe(0);
      const pages = parsePagesOutput(pagesResult.stdout);
      const runTwoPage = pages.find((entry) => entry.url.includes("run=two"));
      expect(runTwoPage).toBeDefined();

      const actionsResult = await librettoCli(
        `actions --session ${session} --page ${runTwoPage?.id} --action reload --last 20`,
      );
      expect(actionsResult.exitCode).toBe(0);
      expect(actionsResult.stdout).toContain("action(s) shown.");
      expect(actionsResult.stdout).toContain("run=two");

      const networkResult = await librettoCli(
        `network --session ${session} --page ${runTwoPage?.id} --last 20`,
      );
      expect(networkResult.exitCode).toBe(0);
      expect(networkResult.stdout).toContain("request(s) shown.");
      expect(networkResult.stdout).toContain("run=two");
    } finally {
      await librettoCli(`resume --session ${session}`);
      await librettoCli(`close --session ${session}`);
    }
  }, 90_000);
});
