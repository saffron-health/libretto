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
