import { createServer, type IncomingHttpHeaders } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect } from "vitest";
import { test as base } from "./fixtures.js";

type CapturedRequest = {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
};

type BillingApiServer = {
  url: string;
  requests: CapturedRequest[];
};

const test = base.extend<{ billingApiServer: BillingApiServer }>({
  billingApiServer: async ({}, use) => {
    const requests: CapturedRequest[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        requests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });

        if (req.url === "/v1/billing/openPlansPage") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              json: {
                url: "https://api.libretto.sh/billing/plans?token=test-token",
              },
            }),
          );
          return;
        }

        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected billing test server to listen on a TCP port.");
    }

    await use({
      url: `http://127.0.0.1:${address.port}`,
      requests,
    });

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  },
});

describe("billing CLI", () => {
  test("opens the portal with the stored session cookie even when an API key is set", async ({
    billingApiServer,
    librettoCli,
    workspaceDir,
    workspacePath,
  }) => {
    await mkdir(workspacePath(".libretto"), { recursive: true });
    await writeFile(
      workspacePath(".libretto", "auth.json"),
      JSON.stringify({
        apiUrl: billingApiServer.url,
        session: {
          cookie: "better-auth.session_token=test-session",
          userId: "user-test",
          email: "user@example.com",
          expiresAt: null,
        },
      }),
      "utf8",
    );

    const result = await librettoCli("cloud billing portal", {
      HOME: workspaceDir,
      LIBRETTO_API_KEY: "test-api-key",
      LIBRETTO_API_URL: billingApiServer.url,
    });

    expect(result.stdout).toContain(
      "https://api.libretto.sh/billing/plans?token=test-token",
    );
    expect(result.stderr).toBe("");
    expect(billingApiServer.requests).toHaveLength(1);
    expect(billingApiServer.requests[0]?.url).toBe(
      "/v1/billing/openPlansPage",
    );
    expect(billingApiServer.requests[0]?.headers.cookie).toBe(
      "better-auth.session_token=test-session",
    );
    expect(billingApiServer.requests[0]?.headers["x-api-key"]).toBeUndefined();
    expect(JSON.parse(billingApiServer.requests[0]?.body ?? "{}")).toEqual({
      json: {},
    });
  });

  test("does not open the browser portal with only API-key auth", async ({
    billingApiServer,
    librettoCli,
    workspaceDir,
  }) => {
    const result = await librettoCli("cloud billing portal", {
      HOME: workspaceDir,
      LIBRETTO_API_KEY: "test-api-key",
      LIBRETTO_API_URL: billingApiServer.url,
    });

    expect(result.stderr).toContain(
      "Billing portal requires an interactive login session.",
    );
    expect(result.stderr).toContain("libretto cloud auth login");
    expect(result.stderr).toContain("libretto cloud billing status");
    expect(result.stdout).toBe("");
    expect(billingApiServer.requests).toHaveLength(0);
  });
});
