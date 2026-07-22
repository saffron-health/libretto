import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openInput } from "../src/cli/commands/browser.js";
import { normalizeDomain, normalizeUrl } from "../src/cli/core/browser.js";
import { resolveProviderName } from "../src/cli/core/providers/index.js";
import { createKernelProvider } from "../src/cli/core/providers/kernel.js";
import { createLibrettoCloudProvider } from "../src/cli/core/providers/libretto-cloud.js";
import { createSteelProvider } from "../src/cli/core/providers/steel.js";
import { test } from "./fixtures.js";

describe("browser URL normalization", () => {
  test("adds https to bare hostnames", () => {
    expect(normalizeUrl("example.com").href).toBe("https://example.com/");
  });

  test("adds https to bare hosts with ports", () => {
    expect(normalizeUrl("localhost:3000").href).toBe("https://localhost:3000/");
  });

  test("treats bare hosts with embedded redirect URLs as bare hosts", () => {
    expect(normalizeUrl("example.com?redirect=https://idp.com").href).toBe(
      "https://example.com/?redirect=https://idp.com",
    );
  });

  test("preserves explicit https URLs", () => {
    expect(normalizeUrl("https://example.com").href).toBe(
      "https://example.com/",
    );
  });

  test("preserves file URLs", () => {
    expect(normalizeUrl("file:///tmp/example.html").href).toBe(
      "file:///tmp/example.html",
    );
  });

  test("preserves about:blank", () => {
    expect(normalizeUrl("about:blank").href).toBe("about:blank");
  });

  test("normalizes www hostnames from parsed URLs", () => {
    expect(normalizeDomain(normalizeUrl("https://www.example.com/path"))).toBe(
      "example.com",
    );
  });
});

describe("open command input", () => {
  test("defaults URL to about:blank", () => {
    expect(openInput.parse({ positionals: [], named: {} }).url).toBe(
      "about:blank",
    );
  });
});

describe("provider resolution via CLI", () => {
  test("open rejects invalid --provider flag", async ({ librettoCli }) => {
    const result = await librettoCli(
      "open https://example.com --provider invalid",
    );
    expect(result.stderr).toContain('Invalid provider "invalid"');
    expect(result.stderr).toContain("Valid providers:");
  });

  test("open accepts valid --provider flag", async ({ librettoCli }) => {
    // kernel provider will fail without API key, but provider resolution itself succeeds
    const result = await librettoCli(
      "open https://example.com --provider kernel",
    );
    // Should NOT contain "Invalid provider" — it got past resolution
    expect(result.stderr).not.toContain("Invalid provider");
  });

  test("LIBRETTO_PROVIDER env var rejects invalid values", () => {
    vi.stubEnv("LIBRETTO_PROVIDER", "invalid");
    expect(() => resolveProviderName()).toThrow('Invalid provider "invalid"');
    expect(() => resolveProviderName()).toThrow("LIBRETTO_PROVIDER env var");
  });

  test("--provider flag overrides LIBRETTO_PROVIDER env var", async ({
    librettoCli,
  }) => {
    // Flag says "kernel", env says "browserbase" — flag should win.
    // kernel will fail without API key, but the error should mention kernel, not browserbase.
    const result = await librettoCli(
      "open https://example.com --provider kernel",
      {
        LIBRETTO_PROVIDER: "browserbase",
      },
    );
    expect(result.stderr).not.toContain("Invalid provider");
    // If it got past resolution to actually trying kernel, it won't mention browserbase
    expect(result.stderr).not.toContain("browserbase");
  });

  test("open loads Browserbase credentials from workspace .env", async ({
    librettoCli,
    workspacePath,
  }) => {
    await writeFile(
      workspacePath(".env"),
      [
        "BROWSERBASE_API_KEY=test-key",
        "BROWSERBASE_PROJECT_ID=test-project",
        "BROWSERBASE_ENDPOINT=http://127.0.0.1:9",
        "",
      ].join("\n"),
    );

    const result = await librettoCli(
      "open https://example.com --provider browserbase",
      {
        BROWSERBASE_API_KEY: undefined,
        BROWSERBASE_PROJECT_ID: undefined,
        BROWSERBASE_ENDPOINT: undefined,
      },
    );

    expect(result.stderr).not.toContain("BROWSERBASE_API_KEY is required");
    expect(result.stderr).not.toContain("BROWSERBASE_PROJECT_ID is required");
  });
});

describe("Steel provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("creates sessions and builds the documented CDP endpoint", async () => {
    vi.stubEnv("STEEL_API_KEY", "test-key");
    vi.stubEnv("STEEL_BASE_URL", "https://steel.example.test");
    vi.stubEnv("STEEL_CONNECT_URL", "wss://connect.example.test");

    const fetchMock = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        if (new URL(String(url)).pathname === "/v1/sessions") {
          return jsonResponse({
            id: "session-ready",
            sessionViewerUrl: "https://app.steel.dev/sessions/session-ready",
          });
        }
        return new Response("not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await createSteelProvider().createSession();

    expect(session).toEqual({
      sessionId: "session-ready",
      cdpEndpoint:
        "wss://connect.example.test/?apiKey=test-key&sessionId=session-ready",
      liveViewUrl: "https://app.steel.dev/sessions/session-ready",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://steel.example.test/v1/sessions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "steel-api-key": "test-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          solveCaptcha: true,
          useProxy: true,
          stealthConfig: {
            humanizeInteractions: true,
            autoCaptchaSolving: true,
            skipFingerprintInjection: false,
          },
        }),
      }),
    );
  });

  it("releases sessions through the Steel release endpoint", async () => {
    vi.stubEnv("STEEL_API_KEY", "test-key");
    vi.stubEnv("STEEL_BASE_URL", "https://steel.example.test");

    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, message: "released" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createSteelProvider().closeSession("session-ready");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://steel.example.test/v1/sessions/session-ready/release",
      expect.objectContaining({
        method: "POST",
        headers: {
          "steel-api-key": "test-key",
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
  });

  it("uses direct API key options before Steel environment variables", async () => {
    vi.stubEnv("STEEL_API_KEY", "env-key");
    vi.stubEnv("STEEL_BASE_URL", "https://steel.example.test");
    vi.stubEnv("STEEL_CONNECT_URL", "wss://connect.example.test");

    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "session-ready",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await createSteelProvider({
      apiKey: "option-key",
    }).createSession();

    expect(session.cdpEndpoint).toBe(
      "wss://connect.example.test/?apiKey=option-key&sessionId=session-ready",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://steel.example.test/v1/sessions",
      expect.objectContaining({
        headers: expect.objectContaining({
          "steel-api-key": "option-key",
        }),
      }),
    );
  });
});

describe("provider session status display", () => {
  test("status shows provider name and CDP endpoint for cloud sessions", async ({
    librettoCli,
    seedSessionState,
  }) => {
    await seedSessionState({
      session: "cloud-test",
      port: 0,
      pid: undefined,
      status: "active",
      cdpEndpoint: "wss://connect.example.com/session/abc123",
      provider: { name: "kernel", sessionId: "abc123" },
    });
    const result = await librettoCli("status");
    expect(result.stdout).toContain("kernel");
    expect(result.stdout).toContain("wss://connect.example.com/session/abc123");
    expect(result.stdout).not.toContain("127.0.0.1:0");
  });

  test("status does not show bogus 127.0.0.1:0 for cloud sessions", async ({
    librettoCli,
    seedSessionState,
  }) => {
    await seedSessionState({
      session: "cloud-check",
      port: 0,
      pid: undefined,
      status: "active",
      cdpEndpoint: "wss://cloud.example.com/session/xyz",
      provider: { name: "browserbase", sessionId: "xyz" },
    });
    const result = await librettoCli("status");
    expect(result.stdout).toContain("browserbase");
    expect(result.stdout).not.toContain("127.0.0.1:0");
  });
});

describe("provider session guards", () => {
  test("open rejects overwriting an active cloud provider session", async ({
    librettoCli,
    seedSessionState,
  }) => {
    await seedSessionState({
      session: "cloud-active",
      port: 0,
      pid: undefined,
      status: "active",
      cdpEndpoint: "wss://connect.example.com/session/existing",
      provider: { name: "kernel", sessionId: "existing" },
    });
    const result = await librettoCli(
      "open https://example.com --session cloud-active",
    );
    expect(result.stderr).toContain("already open");
    expect(result.stderr).toContain("kernel");
  });
});

describe("Kernel provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses constructor options before environment defaults", async () => {
    vi.stubEnv("KERNEL_API_KEY", "env-key");
    vi.stubEnv("KERNEL_HEADLESS", "false");
    vi.stubEnv("KERNEL_STEALTH", "false");
    vi.stubEnv("KERNEL_TIMEOUT_SECONDS", "111");

    const fetchMock = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/browsers") {
          return jsonResponse({
            session_id: "kernel-session",
            cdp_ws_url: "wss://kernel.example.test/cdp",
            browser_live_view_url: "https://kernel.example.test/live",
          });
        }
        return new Response("not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await createKernelProvider({
      apiKey: "constructor-key",
      headless: true,
      stealth: true,
      timeoutSeconds: 222,
    }).createSession();

    expect(session).toEqual({
      sessionId: "kernel-session",
      cdpEndpoint: "wss://kernel.example.test/cdp",
      liveViewUrl: "https://kernel.example.test/live",
      recordingUrl: undefined,
      startUrlPreloaded: false,
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer constructor-key",
    });
    expect(await readJsonBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      headless: true,
      stealth: true,
      timeout_seconds: 222,
    });
  });

  it("uses per-session headless mode before provider defaults", async () => {
    vi.stubEnv("KERNEL_API_KEY", "env-key");

    const fetchMock = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/browsers") {
          return jsonResponse({
            session_id: "kernel-session",
            cdp_ws_url: "wss://kernel.example.test/cdp",
            browser_live_view_url: null,
          });
        }
        return new Response("not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await createKernelProvider({
      apiKey: "constructor-key",
      headless: false,
    }).createSession({ headless: true });

    expect(await readJsonBody(fetchMock.mock.calls[0]?.[1])).toMatchObject({
      headless: true,
    });
  });

  it("forwards startUrl, gpu, and viewport and marks startUrlPreloaded", async () => {
    vi.stubEnv("KERNEL_API_KEY", "env-key");

    const fetchMock = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/browsers") {
          return jsonResponse({
            session_id: "kernel-session",
            cdp_ws_url: "wss://kernel.example.test/cdp",
            browser_live_view_url: null,
          });
        }
        return new Response("not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await createKernelProvider({
      apiKey: "constructor-key",
    }).createSession({
      startUrl: "https://www.marriott.com/",
      gpu: true,
      viewport: { width: 1440, height: 900 },
    });

    expect(session.startUrlPreloaded).toBe(true);
    expect(await readJsonBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      headless: true,
      stealth: false,
      timeout_seconds: 300,
      start_url: "https://www.marriott.com/",
      gpu: true,
      viewport: { width: 1440, height: 900 },
    });
  });

  it("starts and stops replay recording when enabled", async () => {
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;
        const method = init?.method;
        if (pathname === "/browsers" && method === "POST") {
          return jsonResponse({
            session_id: "kernel-recorded",
            cdp_ws_url: "wss://kernel.example.test/recorded",
            browser_live_view_url: "https://kernel.example.test/live",
          });
        }
        if (pathname === "/browsers/kernel-recorded/replays") {
          return jsonResponse({
            replay_id: "replay-123",
            replay_view_url: "https://kernel.example.test/replay",
          });
        }
        if (
          pathname === "/browsers/kernel-recorded/replays/replay-123/stop"
        ) {
          return new Response(null, { status: 200 });
        }
        if (pathname === "/browsers/kernel-recorded" && method === "DELETE") {
          return new Response(null, { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createKernelProvider({
      apiKey: "test-key",
      enableRecording: true,
    });

    const session = await provider.createSession();
    expect(session).toEqual({
      sessionId: "kernel-recorded",
      cdpEndpoint: "wss://kernel.example.test/recorded",
      liveViewUrl: "https://kernel.example.test/live",
      recordingUrl: "https://kernel.example.test/replay",
      startUrlPreloaded: false,
    });

    await expect(provider.closeSession("kernel-recorded")).resolves.toEqual({
      replayUrl: "https://kernel.example.test/replay",
    });
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname))
      .toEqual([
        "/browsers",
        "/browsers/kernel-recorded/replays",
        "/browsers/kernel-recorded/replays/replay-123/stop",
        "/browsers/kernel-recorded",
      ]);
  });
});

describe("Libretto Cloud provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("defaults cloud browser sessions to 60 minutes", async () => {
    vi.stubEnv("LIBRETTO_API_KEY", "test-key");

    const fetchMock = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/v1/sessions/create") {
          return jsonResponse({
            json: {
              session_id: "session-ready",
              status: "open",
              cdp_url: "wss://cloud.example.test/devtools/session-ready",
              live_view_url: null,
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await createLibrettoCloudProvider().createSession();

    expect(session.sessionId).toBe("session-ready");
    expect(await readJsonBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      json: { timeout_seconds: 3600 },
    });
  });

  it("passes requested headless mode to cloud browser sessions", async () => {
    vi.stubEnv("LIBRETTO_API_KEY", "test-key");

    const fetchMock = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/v1/sessions/create") {
          return jsonResponse({
            json: {
              session_id: "session-headless",
              status: "open",
              cdp_url: "wss://cloud.example.test/devtools/session-headless",
              live_view_url: null,
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await createLibrettoCloudProvider().createSession({
      headless: true,
    });

    expect(session.sessionId).toBe("session-headless");
    expect(await readJsonBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      json: { timeout_seconds: 3600, headless: true },
    });
  });

  it("waits for queued sessions to receive a CDP URL", async () => {
    vi.stubEnv("LIBRETTO_API_KEY", "test-key");
    vi.stubEnv("LIBRETTO_TIMEOUT_SECONDS", "123");
    vi.stubEnv("LIBRETTO_CLOUD_SESSION_POLL_INTERVAL_MS", "1");

    let getCalls = 0;
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/v1/sessions/create") {
          return jsonResponse({
            json: {
              session_id: "session-queued",
              status: "queued",
              cdp_url: null,
              live_view_url: null,
            },
          });
        }
        if (pathname === "/v1/sessions/get") {
          getCalls += 1;
          return jsonResponse({
            json: {
              session_id: "session-queued",
              status: getCalls === 1 ? "queued" : "open",
              cdp_url:
                getCalls === 1
                  ? null
                  : "wss://cloud.example.test/devtools/session-queued",
              live_view_url:
                getCalls === 1 ? null : "https://cloud.example.test/live",
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await createLibrettoCloudProvider().createSession();

    expect(session).toEqual({
      sessionId: "session-queued",
      cdpEndpoint: "wss://cloud.example.test/devtools/session-queued",
      liveViewUrl: "https://cloud.example.test/live",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await readJsonBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      json: { timeout_seconds: 123 },
    });
  });

  it("closes a queued session when the parent command disconnects before CDP is ready", async () => {
    vi.stubEnv("LIBRETTO_API_KEY", "test-key");
    vi.stubEnv("LIBRETTO_CLOUD_SESSION_POLL_INTERVAL_MS", "1");

    const originalSend = process.send;
    const sendMock = vi.fn();
    (process as typeof process & { send?: typeof process.send }).send =
      sendMock;
    let closeCallFinished = false;

    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/v1/sessions/create") {
          return jsonResponse({
            json: {
              session_id: "session-cancelled",
              status: "queued",
              cdp_url: null,
              live_view_url: null,
            },
          });
        }
        if (pathname === "/v1/sessions/get") {
          return jsonResponse({
            json: {
              session_id: "session-cancelled",
              status: "queued",
              cdp_url: null,
              live_view_url: null,
            },
          });
        }
        if (pathname === "/v1/sessions/close") {
          closeCallFinished = true;
          return jsonResponse({ json: { success: true, message: "closed" } });
        }
        return new Response("not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const sessionPromise = createLibrettoCloudProvider().createSession();

      await waitFor(() =>
        sendMock.mock.calls.some(([message]) =>
          JSON.stringify(message).includes("Waiting for browser capacity"),
        ),
      );
      process.emit("disconnect");

      await expect(sessionPromise).rejects.toThrow(
        "cancelled before browser capacity was available",
      );
      expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname))
        .toContain("/v1/sessions/close");
      expect(closeCallFinished).toBe(true);
    } finally {
      process.send = originalSend;
    }
  });

  it("fetches a recording URL after closing a cloud session", async () => {
    vi.stubEnv("LIBRETTO_API_KEY", "test-key");

    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/v1/sessions/close") {
          return jsonResponse({ json: { success: true, message: "closed" } });
        }
        if (pathname === "/v1/recordings/get") {
          expect(await readJsonBody(init)).toEqual({
            json: { session_id: "session-closed" },
          });
          return jsonResponse({
            json: {
              recording_url: "https://api.example.test/recordings/session-closed?t=signed",
              recording_url_expires_at: "2026-05-27T00:00:00.000Z",
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLibrettoCloudProvider().closeSession("session-closed"),
    ).resolves.toEqual({
      replayUrl: "https://api.example.test/recordings/session-closed?t=signed",
    });
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname))
      .toEqual(["/v1/sessions/close", "/v1/recordings/get"]);
  });
});

async function readJsonBody(init: unknown): Promise<unknown> {
  return JSON.parse(String((init as { body?: unknown })?.body));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 100;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for condition");
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
