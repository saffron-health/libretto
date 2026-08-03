import { readFile } from "node:fs/promises";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

describe("run --cdp", () => {
  test("executes a workflow against an external CDP browser and leaves it alive", async ({
    librettoCli,
    writeWorkflow,
    workspacePath,
  }) => {
    const sourceSession = "run-cdp-source";
    const runSession = "run-cdp-workflow";

    await librettoCli(
      `open about:blank --headless --session ${sourceSession}`,
    );

    const sourceState = JSON.parse(
      await readFile(
        workspacePath(".libretto", "sessions", sourceSession, "state.json"),
        "utf8",
      ),
    ) as { port: number; pid: number };

    const integrationFilePath = await writeWorkflow(
      "integration-run-cdp.mjs",
      `
export default workflow(
  "main",
  { startUrl: "https://example.com/" },
  async ({ page }) => {
    console.log("CDP_RUN_URL", page.url());
    console.log("CDP_RUN_TITLE", await page.title());
  },
);
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --cdp http://127.0.0.1:${sourceState.port} --session ${runSession}`,
    );
    expect(result.stdout).toContain("Connecting to CDP endpoint");
    expect(result.stdout).toContain("CDP_RUN_URL https://example.com/");
    expect(result.stdout).toContain("CDP_RUN_TITLE Example Domain");
    expect(result.stdout).toContain("Integration completed.");

    const missingRunSession = await librettoCli(`pages --session ${runSession}`);
    expect(missingRunSession.stderr).toContain(
      `No session "${runSession}" found.`,
    );
    expect(missingRunSession.stderr).toContain(`Active sessions:`);
    expect(missingRunSession.stderr).toContain(sourceSession);

    // Source open session still owns the live browser.
    const sourcePages = await librettoCli(`pages --session ${sourceSession}`);
    expect(sourcePages.stdout).toContain("example.com");
    expect(() => process.kill(sourceState.pid, 0)).not.toThrow();
  }, 90_000);

  test("run --cdp --page targets a specific discovered page", async ({
    librettoCli,
    writeWorkflow,
    workspacePath,
  }) => {
    const sourceSession = "run-cdp-page-source";
    const runSession = "run-cdp-page-target";

    const opened = await librettoCli(
      `open https://example.com --headless --session ${sourceSession}`,
    );
    expect(opened.stdout).toContain("Browser open");

    await librettoCli(
      `exec "const p = await context.newPage(); await p.goto('data:text/html,<body>page-one</body>'), context.pages().length" --session ${sourceSession}`,
    );

    const sourcePages = await librettoCli(`pages --session ${sourceSession}`);
    expect(sourcePages.stderr).toBe("");
    expect(sourcePages.stdout).toContain("id=page-0");
    expect(sourcePages.stdout).toContain("page-one");
    const pageLines = sourcePages.stdout
      .trimEnd()
      .split("\n")
      .filter((line) => line.startsWith("  id="));
    expect(pageLines).toHaveLength(2);

    const sourceState = JSON.parse(
      await readFile(
        workspacePath(".libretto", "sessions", sourceSession, "state.json"),
        "utf8",
      ),
    ) as { port: number };

    const integrationFilePath = await writeWorkflow(
      "integration-run-cdp-page.mjs",
      `
export default workflow(
  "main",
  { startUrl: "https://example.com/user/" },
  async ({ page }) => {
    console.log("CDP_PAGE_URL", page.url());
  },
);
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --cdp http://127.0.0.1:${sourceState.port} --session ${runSession} --page page-1`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Integration completed.");
    expect(result.stdout).toContain("CDP_PAGE_URL https://example.com/user/");

    // page-1 received startUrl; the other discovered page should still show page-one.
    const afterPages = await librettoCli(`pages --session ${sourceSession}`);
    expect(afterPages.stdout).toContain("https://example.com/user/");
    expect(afterPages.stdout).toContain("page-one");
  }, 90_000);

  test("run --cdp --stay-open-on-success keeps the Libretto session for inspection", async ({
    librettoCli,
    writeWorkflow,
    workspacePath,
  }) => {
    const sourceSession = "run-cdp-stay-open-source";
    const runSession = "run-cdp-stay-open";

    await librettoCli(
      `open about:blank --headless --session ${sourceSession}`,
    );

    const sourceState = JSON.parse(
      await readFile(
        workspacePath(".libretto", "sessions", sourceSession, "state.json"),
        "utf8",
      ),
    ) as { port: number };

    const integrationFilePath = await writeWorkflow(
      "integration-run-cdp-stay-open.mjs",
      `
export default workflow(
  "main",
  { startUrl: "https://example.com/" },
  async ({ page }) => {
    console.log("CDP_STAY_OPEN", await page.title());
  },
);
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --cdp http://127.0.0.1:${sourceState.port} --session ${runSession} --stay-open-on-success`,
    );
    expect(result.stdout).toContain("CDP_STAY_OPEN Example Domain");
    expect(result.stdout).toContain("Integration completed.");
    expect(result.stdout).toContain("Browser is still open");

    const pages = await librettoCli(`pages --session ${runSession}`);
    expect(pages.stdout).toContain("example.com");

    const snapshot = await librettoCli(`snapshot --session ${runSession}`);
    expect(snapshot.stdout).toMatch(/Example Domain|example\.com/i);
  }, 90_000);
});
