import { readFile } from "node:fs/promises";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

describe("run --cdp", () => {
  test("attaches without navigating away from the existing page", async ({
    librettoCli,
    writeWorkflow,
    workspacePath,
  }) => {
    const sourceSession = "run-cdp-source";
    const runSession = "run-cdp-workflow";

    await librettoCli(
      `open about:blank --headless --session ${sourceSession}`,
    );
    await librettoCli(
      `exec "await page.setContent('<title>CDP Existing</title><body>keep-me</body>'), await page.title()" --session ${sourceSession}`,
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
    console.log("CDP_RUN_BODY", await page.locator("body").innerText());
  },
);
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --cdp http://127.0.0.1:${sourceState.port} --session ${runSession}`,
    );
    expect(result.stdout).toContain("Connecting to CDP endpoint");
    expect(result.stdout).toContain("CDP_RUN_TITLE CDP Existing");
    expect(result.stdout).toContain("CDP_RUN_BODY keep-me");
    expect(result.stdout).not.toContain("CDP_RUN_URL https://example.com/");
    expect(result.stdout).toContain("Integration completed.");

    const missingRunSession = await librettoCli(`pages --session ${runSession}`);
    expect(missingRunSession.stderr).toContain(
      `No session "${runSession}" found.`,
    );
    expect(missingRunSession.stderr).toContain(`Active sessions:`);
    expect(missingRunSession.stderr).toContain(sourceSession);

    // Source open session still owns the live browser on the original page.
    const sourcePages = await librettoCli(`pages --session ${sourceSession}`);
    expect(sourcePages.stdout).toContain("about:blank");
    expect(sourcePages.stdout).not.toContain("example.com");
    expect(() => process.kill(sourceState.pid, 0)).not.toThrow();
  }, 90_000);

  test("run --cdp --page targets a specific discovered page without navigating", async ({
    librettoCli,
    writeWorkflow,
    workspacePath,
  }) => {
    const sourceSession = "run-cdp-page-source";
    const probeSession = "run-cdp-page-probe";
    const runSession = "run-cdp-page-target";

    const opened = await librettoCli(
      `open https://example.com --headless --session ${sourceSession}`,
    );
    expect(opened.stdout).toContain("Browser open");

    await librettoCli(
      `exec "const p = await context.newPage(); await p.goto('data:text/html,<body>page-one</body>'), context.pages().length" --session ${sourceSession}`,
    );

    const sourceState = JSON.parse(
      await readFile(
        workspacePath(".libretto", "sessions", sourceSession, "state.json"),
        "utf8",
      ),
    ) as { port: number };

    // Probe with connect so page-N ids match the order run --cdp will see.
    await librettoCli(
      `connect http://127.0.0.1:${sourceState.port} --session ${probeSession}`,
    );
    const probePages = await librettoCli(`pages --session ${probeSession}`);
    expect(probePages.stderr).toBe("");
    const pageOneLine = probePages.stdout
      .split("\n")
      .find((line) => line.includes("page-one"));
    expect(pageOneLine).toBeTruthy();
    const pageOneId = pageOneLine!.match(/id=([^\s]+)/)?.[1];
    expect(pageOneId).toMatch(/^page-\d+$/);
    await librettoCli(`close --session ${probeSession}`);

    const integrationFilePath = await writeWorkflow(
      "integration-run-cdp-page.mjs",
      `
export default workflow(
  "main",
  { startUrl: "https://example.com/user/" },
  async ({ page }) => {
    console.log("CDP_PAGE_URL", page.url());
    console.log("CDP_PAGE_BODY", await page.locator("body").innerText());
  },
);
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --cdp http://127.0.0.1:${sourceState.port} --session ${runSession} --page ${pageOneId}`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Integration completed.");
    expect(result.stdout).toContain("CDP_PAGE_BODY page-one");
    expect(result.stdout).not.toContain(
      "CDP_PAGE_URL https://example.com/user/",
    );

    const afterPages = await librettoCli(`pages --session ${sourceSession}`);
    expect(afterPages.stdout).toContain("page-one");
    expect(afterPages.stdout).not.toContain("https://example.com/user/");
    expect(afterPages.stdout).toMatch(
      /id=page-0 url=https:\/\/example\.com\/?(?: |\n|$)/,
    );
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
    await librettoCli(
      `exec "await page.setContent('<title>Stay Open CDP</title><body>inspect-me</body>'), await page.title()" --session ${sourceSession}`,
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
    expect(result.stdout).toContain("CDP_STAY_OPEN Stay Open CDP");
    expect(result.stdout).toContain("Integration completed.");
    expect(result.stdout).toContain("Browser is still open");

    const pages = await librettoCli(`pages --session ${runSession}`);
    expect(pages.stdout).toContain("about:blank");
    expect(pages.stdout).not.toContain("example.com");

    const snapshot = await librettoCli(`snapshot --session ${runSession}`);
    expect(snapshot.stdout).toMatch(/Stay Open CDP|inspect-me/i);
  }, 90_000);

  test("run --cdp without startUrl still attaches and runs the handler", async ({
    librettoCli,
    writeWorkflow,
    workspacePath,
  }) => {
    const sourceSession = "run-cdp-no-starturl-source";
    const runSession = "run-cdp-no-starturl";

    await librettoCli(
      `open about:blank --headless --session ${sourceSession}`,
    );
    await librettoCli(
      `exec "await page.setContent('<title>No StartUrl</title><body>ready</body>'), await page.title()" --session ${sourceSession}`,
    );

    const sourceState = JSON.parse(
      await readFile(
        workspacePath(".libretto", "sessions", sourceSession, "state.json"),
        "utf8",
      ),
    ) as { port: number };

    const integrationFilePath = await writeWorkflow(
      "integration-run-cdp-no-starturl.mjs",
      `
export default workflow("main", async ({ page }) => {
  console.log("CDP_NO_STARTURL", await page.title());
});
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --cdp http://127.0.0.1:${sourceState.port} --session ${runSession}`,
    );
    expect(result.stdout).toContain("CDP_NO_STARTURL No StartUrl");
    expect(result.stdout).toContain("Integration completed.");
  }, 90_000);
});

describe("run launch startUrl", () => {
  test("navigates to workflow startUrl when Libretto launches the browser", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-run-launch-starturl.mjs",
      `
export default workflow(
  "main",
  { startUrl: "https://example.com/" },
  async ({ page }) => {
    console.log("LAUNCH_RUN_URL", page.url());
    console.log("LAUNCH_RUN_TITLE", await page.title());
  },
);
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session run-launch-starturl --headless`,
    );
    expect(result.stdout).toContain("LAUNCH_RUN_URL https://example.com/");
    expect(result.stdout).toContain("LAUNCH_RUN_TITLE Example Domain");
    expect(result.stdout).toContain("Integration completed.");
  }, 90_000);

  test("runs without startUrl when Libretto launches the browser", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-run-launch-no-starturl.mjs",
      `
export default workflow("main", async ({ page }) => {
  console.log("LAUNCH_NO_STARTURL", page.url());
});
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session run-launch-no-starturl --headless`,
    );
    expect(result.stdout).toContain("LAUNCH_NO_STARTURL");
    expect(result.stdout).not.toContain("example.com");
    expect(result.stdout).toContain("Integration completed.");
  }, 90_000);

  test("run --cdp prints workflow call stack for waitForResponse timeouts", async ({
    librettoCli,
    writeWorkflow,
    workspacePath,
  }) => {
    const sourceSession = "run-cdp-wait-stack-source";
    const runSession = "run-cdp-wait-stack-run";

    await librettoCli(
      `open about:blank --headless --session ${sourceSession}`,
    );
    await librettoCli(
      `exec "await page.setContent('<title>CDP Wait Stack</title>'), await page.title()" --session ${sourceSession}`,
    );

    const sourceState = JSON.parse(
      await readFile(
        workspacePath(".libretto", "sessions", sourceSession, "state.json"),
        "utf8",
      ),
    ) as { port: number };

    const integrationFilePath = await writeWorkflow(
      "integration-run-cdp-wait-stack.ts",
      `
async function waitForMissingApi(page: import("playwright").Page) {
  await page.waitForResponse("**/never-comes-from-cdp-workflow", {
    timeout: 500,
  });
}

async function extractExampleData(page: import("playwright").Page) {
  await waitForMissingApi(page);
}

export default workflow("main", async ({ page }) => {
  await extractExampleData(page);
});
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --cdp http://127.0.0.1:${sourceState.port} --session ${runSession}`,
    );
    expect(result.stderr).toContain(
      'page.waitForResponse: Timeout 500ms exceeded while waiting for event "response"',
    );
    expect(result.stderr).toContain("at waitForMissingApi (");
    expect(result.stderr).toContain("integration-run-cdp-wait-stack.ts");
    expect(result.stderr).toContain("at extractExampleData (");
  }, 90_000);

  test("run --cdp surfaces unreachable endpoint instead of a generic daemon exit", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const endpoint = "ws://127.0.0.1:1/devtools/browser/fake";
    const integrationFilePath = await writeWorkflow(
      "integration-run-cdp-unreachable.mjs",
      `
export default workflow("main", async () => "should-not-run");
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --cdp ${endpoint} --session run-cdp-unreachable`,
    );

    expect(result.stderr).toContain(`Failed to connect to CDP endpoint ${endpoint}`);
    expect(result.stderr).toContain("ECONNREFUSED");
    expect(result.stderr).not.toContain("Daemon exited before startup");
    expect(result.stdout).not.toContain("should-not-run");
    expect(result.stdout).not.toContain("Integration completed.");
  });

  test("run --cdp --page reports missing page ids with recovery guidance", async ({
    librettoCli,
    writeWorkflow,
    workspacePath,
  }) => {
    const sourceSession = "run-cdp-missing-page-source";
    const runSession = "run-cdp-missing-page-run";

    await librettoCli(
      `open about:blank --headless --session ${sourceSession}`,
    );
    const sourceState = JSON.parse(
      await readFile(
        workspacePath(".libretto", "sessions", sourceSession, "state.json"),
        "utf8",
      ),
    ) as { port: number };
    const endpoint = `http://127.0.0.1:${sourceState.port}`;

    const integrationFilePath = await writeWorkflow(
      "integration-run-cdp-missing-page.mjs",
      `
export default workflow("main", async () => "should-not-run");
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --cdp ${endpoint} --page page-99 --session ${runSession}`,
    );

    expect(result.stderr).toContain('Page "page-99" was not found');
    expect(result.stderr).toContain(endpoint);
    expect(result.stderr).toContain("libretto pages");
    expect(result.stderr).not.toContain("Daemon exited before startup");
    expect(result.stdout).not.toContain("should-not-run");
  }, 90_000);
});
