import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect } from "vitest";
import { test as base } from "./fixtures.js";

type RecordedTelemetryRequest = {
  method: string;
  path: string;
  body: unknown;
};

type TelemetryServer = {
  url: string;
  requests: RecordedTelemetryRequest[];
};

const test = base.extend<{ telemetryServer: TelemetryServer }>({
  telemetryServer: async ({}, use) => {
    const requests: RecordedTelemetryRequest[] = [];
    const server = createServer(async (request, response) => {
      const rawBody = await readRequestBody(request);
      requests.push({
        method: request.method ?? "",
        path: request.url ?? "",
        body: rawBody.length > 0 ? (JSON.parse(rawBody) as unknown) : null,
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ json: { success: true } }));
    });

    await listen(server);
    const address = server.address() as AddressInfo;
    await use({
      url: `http://127.0.0.1:${address.port}`,
      requests,
    });
    await close(server);
  },
});

describe("CLI telemetry", () => {
  test("records successful command events", async ({
    librettoCli,
    telemetryServer,
    workspacePath,
  }) => {
    const result = await librettoCli("status", {
      HOME: workspacePath("home"),
      LIBRETTO_API_URL: telemetryServer.url,
    });

    expect(result.stdout).toContain("No open sessions.");
    expect(telemetryServer.requests).toHaveLength(1);
    expect(telemetryServer.requests[0]).toMatchObject({
      method: "POST",
      path: "/v1/telemetry/recordCliEvent",
      body: {
        json: {
          event: "libretto status",
          error: false,
        },
      },
    });
  });

  test("records failing resolved command events without changing the error", async ({
    librettoCli,
    telemetryServer,
    workspacePath,
  }) => {
    const result = await librettoCli("pages --session missing", {
      HOME: workspacePath("home"),
      LIBRETTO_API_URL: telemetryServer.url,
    });

    expect(result.stderr).toContain('No session "missing" found.');
    expect(telemetryServer.requests).toHaveLength(1);
    expect(telemetryServer.requests[0]).toMatchObject({
      method: "POST",
      path: "/v1/telemetry/recordCliEvent",
      body: {
        json: {
          event: "libretto pages",
          error: true,
        },
      },
    });
  });

  test("does not record bypassed help, version, or unknown-command invocations", async ({
    librettoCli,
    telemetryServer,
    workspacePath,
  }) => {
    const env = {
      HOME: workspacePath("home"),
      LIBRETTO_API_URL: telemetryServer.url,
    };

    await librettoCli("", env);
    await librettoCli("help", env);
    await librettoCli("--version", env);
    await librettoCli("nope-command", env);

    expect(telemetryServer.requests).toHaveLength(0);
  });

  test("ignores telemetry transport failures", async ({
    librettoCli,
    workspacePath,
  }) => {
    const result = await librettoCli("status", {
      HOME: workspacePath("home"),
      LIBRETTO_API_URL: await closedServerUrl(),
    });

    expect(result.stdout).toContain("No open sessions.");
    expect(result.stderr).toBe("");
  });
});

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function listen(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function closedServerUrl(): Promise<string> {
  const server = createServer();
  await listen(server);
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  await close(server);
  return url;
}
