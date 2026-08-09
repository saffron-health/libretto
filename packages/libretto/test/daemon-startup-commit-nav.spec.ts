import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect } from "vitest";
import { test as base } from "./fixtures.js";

/**
 * Serves HTML that commits immediately, paints a usable shell, then
 * blocks forever on a script so DOMContentLoaded/load never complete.
 */
type HangAfterCommitServer = {
  url: string;
  close: () => Promise<void>;
};

const test = base.extend<{ hangAfterCommitServer: HangAfterCommitServer }>({
  hangAfterCommitServer: async ({}, use) => {
    const pending: ServerResponse[] = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      if (request.url === "/hang.js") {
        // Never finish — keeps document parsing blocked after the shell.
        pending.push(response);
        request.on("close", () => {
          const index = pending.indexOf(response);
          if (index >= 0) pending.splice(index, 1);
        });
        return;
      }

      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(`<!doctype html>
<html>
  <head><title>Hang After Commit</title></head>
  <body>
    <h1 id="shell">Committed shell</h1>
    <button id="go" type="button">Go</button>
    <script>
      document.getElementById("go").addEventListener("click", () => {
        document.getElementById("shell").textContent = "Clicked";
      });
    </script>
    <script src="/hang.js"></script>
  </body>
</html>`);
    });

    await listen(server);
    const address = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/`;

    await use({
      url,
      close: async () => {
        for (const response of pending) {
          response.destroy();
        }
        pending.length = 0;
        await closeServer(server);
      },
    });

    for (const response of pending) {
      response.destroy();
    }
    pending.length = 0;
    await closeServer(server);
  },
});

describe("daemon startup commit navigation", () => {
  test("run startUrl becomes ready before DOMContentLoaded and can interact with the shell", async ({
    librettoCli,
    writeWorkflow,
    hangAfterCommitServer,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-run-commit-nav.mjs",
      `
export default workflow(
  "main",
  { startUrl: ${JSON.stringify(hangAfterCommitServer.url)} },
  async ({ page }) => {
    console.log("COMMIT_NAV_STARTED");
    await page.locator("#shell").waitFor({ state: "visible", timeout: 10_000 });
    console.log("COMMIT_NAV_SHELL", await page.locator("#shell").textContent());
    await page.locator("#go").click();
    await page.locator("#shell").filter({ hasText: "Clicked" }).waitFor({
      state: "visible",
      timeout: 10_000,
    });
    console.log("COMMIT_NAV_CLICKED", await page.locator("#shell").textContent());
  },
);
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session run-commit-nav --headless`,
    );

    expect(result.stderr).not.toContain("Daemon exited before startup");
    expect(result.stdout).toContain("COMMIT_NAV_STARTED");
    expect(result.stdout).toContain("COMMIT_NAV_SHELL Committed shell");
    expect(result.stdout).toContain("COMMIT_NAV_CLICKED Clicked");
    expect(result.stdout).toContain("Integration completed.");
  }, 90_000);

  test("open startUrl reports ready before DOMContentLoaded and allows interaction", async ({
    librettoCli,
    hangAfterCommitServer,
  }) => {
    const session = "open-commit-nav";
    const opened = await librettoCli(
      `open "${hangAfterCommitServer.url}" --headless --session ${session}`,
    );
    expect(opened.stderr).toBe("");
    expect(opened.stdout).toContain(
      `Browser open (headless): ${hangAfterCommitServer.url}`,
    );

    const clicked = await librettoCli(
      `exec "await page.locator('#shell').waitFor({ state: 'visible', timeout: 10_000 }); await page.locator('#go').click(); await page.locator('#shell').filter({ hasText: 'Clicked' }).waitFor({ state: 'visible', timeout: 10_000 }); await page.locator('#shell').textContent()" --session ${session}`,
    );
    expect(clicked.stderr).toBe("");
    expect(clicked.stdout).toContain("Clicked");
  }, 90_000);

  test("unreachable startUrl still surfaces an actionable startup error", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const unreachable = "http://127.0.0.1:1/";
    const integrationFilePath = await writeWorkflow(
      "integration-run-unreachable-starturl.mjs",
      `
export default workflow(
  "main",
  { startUrl: ${JSON.stringify(unreachable)} },
  async () => "should-not-run",
);
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session run-unreachable-starturl --headless`,
    );

    expect(result.stderr).toMatch(/page\.goto|ERR_CONNECTION_REFUSED|ECONNREFUSED/);
    expect(result.stderr).not.toContain("Daemon exited before startup");
    expect(result.stdout).not.toContain("should-not-run");
    expect(result.stdout).not.toContain("Integration completed.");
  }, 90_000);

  test("unreachable open URL still surfaces an actionable startup error", async ({
    librettoCli,
  }) => {
    const unreachable = "http://127.0.0.1:1/";
    const result = await librettoCli(
      `open "${unreachable}" --headless --session open-unreachable-starturl`,
    );

    expect(result.stderr).toMatch(/page\.goto|ERR_CONNECTION_REFUSED|ECONNREFUSED/);
    expect(result.stderr).not.toContain("Daemon exited before startup");
    expect(result.stdout).not.toContain(`Browser open (headless): ${unreachable}`);
  }, 90_000);
});

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
