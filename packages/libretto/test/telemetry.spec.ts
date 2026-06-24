import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
      LIBRETTO_TELEMETRY_DISABLED: undefined,
      DO_NOT_TRACK: undefined,
      CI: undefined,
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
          packageVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
          buildChannel: "source",
        },
      },
    });
  });

  test("includes configured cloud user id when signed in", async ({
    librettoCli,
    telemetryServer,
    workspacePath,
  }) => {
    const home = workspacePath("home-cloud-account");
    await mkdir(join(home, ".libretto"), { recursive: true });
    await writeFile(
      join(home, ".libretto", "auth.json"),
      JSON.stringify(
        {
          apiUrl: telemetryServer.url,
          session: {
            cookie: "better-auth.session_token=test-session",
            userId: "cloud-account-123",
            email: "person@example.test",
            expiresAt: null,
          },
        },
        null,
        2,
      ),
    );

    const result = await librettoCli("status", {
      HOME: home,
      LIBRETTO_API_URL: telemetryServer.url,
      LIBRETTO_TELEMETRY_DISABLED: undefined,
      DO_NOT_TRACK: undefined,
      CI: undefined,
    });

    expect(result.stdout).toContain("No open sessions.");
    expect(telemetryServer.requests).toHaveLength(1);
    expect(telemetryServer.requests[0]).toMatchObject({
      body: {
        json: {
          cloudUserId: "cloud-account-123",
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
      LIBRETTO_TELEMETRY_DISABLED: undefined,
      DO_NOT_TRACK: undefined,
      CI: undefined,
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
      LIBRETTO_TELEMETRY_DISABLED: undefined,
      DO_NOT_TRACK: undefined,
      CI: undefined,
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
      LIBRETTO_TELEMETRY_DISABLED: undefined,
      DO_NOT_TRACK: undefined,
      CI: undefined,
    });

    expect(result.stdout).toContain("No open sessions.");
    expect(result.stderr).toBe("");
  });

  test("respects environment opt-out controls", async ({
    librettoCli,
    telemetryServer,
    workspacePath,
  }) => {
    const optOuts: Record<string, Record<string, string>> = {
      libretto: { LIBRETTO_TELEMETRY_DISABLED: "1" },
      doNotTrack: { DO_NOT_TRACK: "1" },
      ci: { CI: "1" },
    };

    for (const [name, optOut] of Object.entries(optOuts)) {
      const result = await librettoCli("status", {
        HOME: workspacePath(`home-${name}`),
        LIBRETTO_API_URL: telemetryServer.url,
        LIBRETTO_TELEMETRY_DISABLED: undefined,
        DO_NOT_TRACK: undefined,
        CI: undefined,
        ...optOut,
      });
      expect(result.stdout).toContain("No open sessions.");
    }

    expect(telemetryServer.requests).toHaveLength(0);
  });

  test("respects persistent opt-out in telemetry state", async ({
    librettoCli,
    telemetryServer,
    workspacePath,
  }) => {
    const home = workspacePath("home-persistent-disabled");
    const stateDir = join(home, ".libretto");
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      join(stateDir, "telemetry.json"),
      JSON.stringify({ enabled: false }, null, 2),
    );

    const result = await librettoCli("status", {
      HOME: home,
      LIBRETTO_API_URL: telemetryServer.url,
      LIBRETTO_TELEMETRY_DISABLED: undefined,
      DO_NOT_TRACK: undefined,
      CI: undefined,
    });

    expect(result.stdout).toContain("No open sessions.");
    expect(telemetryServer.requests).toHaveLength(0);
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
