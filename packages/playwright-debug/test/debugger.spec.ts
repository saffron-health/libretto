import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  createPlaywrightDebugger,
  parseAgentModel,
  type DebugAgentRunner,
} from "../src/index.js";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function createPage(): Page {
  return {
    url: vi.fn(() => "https://example.test/dashboard"),
    title: vi.fn(async () => "Dashboard"),
    screenshot: vi.fn(async () => Buffer.from("png")),
    content: vi.fn(async () => "<html><main>Missing submit button</main></html>"),
  } as unknown as Page;
}

function createError(): Error {
  const error = new Error("locator.click: Timeout 5000ms exceeded");
  error.stack = [
    "Error: locator.click: Timeout 5000ms exceeded",
    "    at runAutomation (/repo/src/workflow.ts:12:7)",
  ].join("\n");
  return error;
}

describe("parseAgentModel", () => {
  it("parses provider/model-id strings", () => {
    expect(parseAgentModel("openai/gpt-5.4")).toEqual({
      provider: "openai",
      modelId: "gpt-5.4",
    });
    expect(parseAgentModel("anthropic/claude-sonnet-4-6")).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
  });

  it("rejects unsupported provider strings", () => {
    expect(() => parseAgentModel("google/gemini-3-flash")).toThrow(
      "Unsupported agent model provider",
    );
    expect(() => parseAgentModel("gpt-5.4")).toThrow(
      'Expected "provider/model-id"',
    );
  });
});

describe("createPlaywrightDebugger", () => {
  it("captures failure context and returns no_changes when the agent has no fix", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = url.toString();
      const method = init?.method ?? "GET";
      requests.push({ method, url: requestUrl });
      if (requestUrl.endsWith("/git/ref/heads/main")) {
        return jsonResponse({ object: { sha: "base-commit" } });
      }
      if (requestUrl.endsWith("/git/commits/base-commit")) {
        return jsonResponse({ sha: "base-commit", tree: { sha: "base-tree" } });
      }
      if (requestUrl.includes("/contents/src/workflow.ts?ref=main")) {
        return jsonResponse({
          type: "file",
          encoding: "base64",
          content: Buffer.from("export async function runAutomation() {}").toString(
            "base64",
          ),
        });
      }
      return jsonResponse({ message: "not found" }, { status: 404 });
    }) as unknown as typeof fetch;
    const runner = vi.fn<DebugAgentRunner>(async (context) => {
      expect(context.model).toEqual({ provider: "openai", modelId: "gpt-5.4" });
      expect(context.failure.message).toContain("Timeout");
      expect(context.failure.url).toBe("https://example.test/dashboard");
      expect(context.failure.title).toBe("Dashboard");
      expect(context.failure.screenshot?.base64).toBe("cG5n");
      expect(context.failure.domSnapshot).toContain("Missing submit button");
      expect(context.sourceFiles).toEqual([
        {
          path: "src/workflow.ts",
          content: "export async function runAutomation() {}",
        },
      ]);
      return {
        title: "Investigate submit timeout",
        summary: "No safe fix found",
        rationale: "The failure needs more context.",
        changes: [],
      };
    });

    const debuggerInstance = createPlaywrightDebugger({
      github: {
        owner: "acme",
        repo: "automations",
        baseBranch: "main",
        token: "ghs_test",
        repositoryRoot: "/repo",
      },
      agent: {
        model: "openai/gpt-5.4",
      },
      fetch: fetchImpl,
      modelRunner: runner,
    });

    const result = await debuggerInstance.debugPlaywrightFailure(
      createError(),
      createPage(),
    );

    expect(result.status).toBe("no_changes");
    expect(runner).toHaveBeenCalledOnce();
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "GET",
    ]);
  });

  it("relativizes Windows absolute stack paths against the repository root", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = url.toString();
      if (requestUrl.endsWith("/git/ref/heads/main")) {
        return jsonResponse({ object: { sha: "base-commit" } });
      }
      if (requestUrl.endsWith("/git/commits/base-commit")) {
        return jsonResponse({ sha: "base-commit", tree: { sha: "base-tree" } });
      }
      if (requestUrl.includes("/contents/src/workflow.ts?ref=main")) {
        return jsonResponse({
          type: "file",
          encoding: "base64",
          content: Buffer.from("export async function runAutomation() {}").toString(
            "base64",
          ),
        });
      }
      return jsonResponse({ message: "not found" }, { status: 404 });
    }) as unknown as typeof fetch;
    const runner = vi.fn<DebugAgentRunner>(async (context) => {
      expect(context.sourceFiles).toEqual([
        {
          path: "src/workflow.ts",
          content: "export async function runAutomation() {}",
        },
      ]);
      return {
        title: "Investigate submit timeout",
        summary: "No safe fix found",
        rationale: "The failure needs more context.",
        changes: [],
      };
    });
    const error = new Error("locator.click: Timeout 5000ms exceeded");
    error.stack = [
      "Error: locator.click: Timeout 5000ms exceeded",
      "    at runAutomation (C:\\repo\\src\\workflow.ts:12:7)",
    ].join("\n");

    const debuggerInstance = createPlaywrightDebugger({
      github: {
        owner: "acme",
        repo: "automations",
        baseBranch: "main",
        token: "ghs_test",
        repositoryRoot: "C:\\repo",
      },
      agent: {
        model: "openai/gpt-5.4",
      },
      fetch: fetchImpl,
      modelRunner: runner,
    });

    await debuggerInstance.debugPlaywrightFailure(error, createPage());

    expect(runner).toHaveBeenCalledOnce();
  });

  it("writes model changes through the GitHub Git API and opens a pull request", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = url.toString();
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, url: requestUrl, body });
      if (requestUrl.endsWith("/git/ref/heads/main")) {
        return jsonResponse({ object: { sha: "base-commit" } });
      }
      if (requestUrl.endsWith("/git/commits/base-commit")) {
        return jsonResponse({ sha: "base-commit", tree: { sha: "base-tree" } });
      }
      if (requestUrl.includes("/contents/src/workflow.ts?ref=main")) {
        return jsonResponse({
          type: "file",
          encoding: "base64",
          content: Buffer.from("await page.locator('#old').click();").toString(
            "base64",
          ),
        });
      }
      if (method === "POST" && requestUrl.endsWith("/git/refs")) {
        return jsonResponse({ ref: "refs/heads/libretto-debug/test" });
      }
      if (method === "POST" && requestUrl.endsWith("/git/blobs")) {
        return jsonResponse({ sha: "blob-sha" });
      }
      if (method === "POST" && requestUrl.endsWith("/git/trees")) {
        return jsonResponse({ sha: "tree-sha" });
      }
      if (method === "POST" && requestUrl.endsWith("/git/commits")) {
        return jsonResponse({ sha: "new-commit", tree: { sha: "tree-sha" } });
      }
      if (
        method === "PATCH" &&
        requestUrl.includes(
          "/git/refs/heads/libretto-debug%2Facme-automations-20260713T220000000Z-",
        )
      ) {
        return jsonResponse({});
      }
      if (method === "POST" && requestUrl.endsWith("/pulls")) {
        return jsonResponse({
          html_url: "https://github.com/acme/automations/pull/123",
        });
      }
      return jsonResponse({ message: "not found" }, { status: 404 });
    }) as unknown as typeof fetch;

    const debuggerInstance = createPlaywrightDebugger({
      github: {
        owner: "acme",
        repo: "automations",
        baseBranch: "main",
        token: "ghs_test",
        repositoryRoot: "/repo",
      },
      agent: {
        model: "anthropic/claude-sonnet-4-6",
      },
      fetch: fetchImpl,
      now: () => new Date("2026-07-13T22:00:00.000Z"),
      modelRunner: async () => ({
        title: "Use the new submit selector",
        summary: "Use the new submit selector",
        rationale: "The DOM shows the old selector no longer exists.",
        changes: [
          {
            path: "src/workflow.ts",
            content: "await page.getByRole('button', { name: 'Submit' }).click();",
          },
        ],
      }),
    });

    const result = await debuggerInstance.debugPlaywrightFailure(
      createError(),
      createPage(),
    );

    expect(result).toMatchObject({
      status: "pull_request_opened",
      branchName: expect.stringMatching(
        /^libretto-debug\/acme-automations-20260713T220000000Z-[0-9a-f]{8}$/,
      ),
      pullRequestUrl: "https://github.com/acme/automations/pull/123",
      changedFiles: ["src/workflow.ts"],
    });
    expect(calls.map((call) => call.method)).toEqual([
      "GET",
      "GET",
      "GET",
      "POST",
      "POST",
      "POST",
      "POST",
      "PATCH",
      "POST",
    ]);
    expect(calls.find((call) => call.url.endsWith("/git/blobs"))?.body).toEqual({
      content: "await page.getByRole('button', { name: 'Submit' }).click();",
      encoding: "utf-8",
    });
    expect(calls.find((call) => call.url.endsWith("/pulls"))?.body).toMatchObject({
      title: "[Libretto Agent]: Use the new submit selector",
      head: expect.stringMatching(
        /^libretto-debug\/acme-automations-20260713T220000000Z-[0-9a-f]{8}$/,
      ),
      base: "main",
    });

    const secondResult = await debuggerInstance.debugPlaywrightFailure(
      createError(),
      createPage(),
    );
    expect(secondResult).toMatchObject({ status: "pull_request_opened" });
    if (
      result.status !== "pull_request_opened" ||
      secondResult.status !== "pull_request_opened"
    ) {
      throw new Error("Expected both debugger runs to open pull requests");
    }
    expect(secondResult.branchName).not.toBe(result.branchName);
  });

  it("uses Libretto Cloud to broker the GitHub installation token", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown; auth?: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = url.toString();
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      const headers = new Headers(init?.headers);
      calls.push({
        method,
        url: requestUrl,
        body,
        auth: headers.get("authorization") ?? headers.get("x-api-key") ?? undefined,
      });
      if (requestUrl === "https://api.libretto.test/v1/github/createInstallationToken") {
        return jsonResponse({
          json: {
            token: "brokered-installation-token",
            expires_at: "2026-07-08T00:00:00Z",
          },
        });
      }
      if (requestUrl.endsWith("/git/ref/heads/main")) {
        return jsonResponse({ object: { sha: "base-commit" } });
      }
      if (requestUrl.endsWith("/git/commits/base-commit")) {
        return jsonResponse({ sha: "base-commit", tree: { sha: "base-tree" } });
      }
      if (requestUrl.includes("/contents/src/workflow.ts?ref=main")) {
        return jsonResponse({
          type: "file",
          encoding: "base64",
          content: Buffer.from("old").toString("base64"),
        });
      }
      return jsonResponse({ message: "not found" }, { status: 404 });
    }) as unknown as typeof fetch;

    const debuggerInstance = createPlaywrightDebugger({
      github: {
        owner: "acme",
        repo: "automations",
        baseBranch: "main",
        librettoApiKey: "libretto-key",
        librettoApiUrl: "https://api.libretto.test",
        repositoryRoot: "/repo",
      },
      agent: {
        model: "openai/gpt-5.4",
      },
      fetch: fetchImpl,
      modelRunner: async () => ({
        title: "No fix",
        summary: "No fix",
        rationale: "No fix",
        changes: [],
      }),
    });

    await debuggerInstance.debugPlaywrightFailure(createError(), createPage());

    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.libretto.test/v1/github/createInstallationToken",
      auth: "libretto-key",
      body: {
        json: {
          owner: "acme",
          repo: "automations",
        },
      },
    });
    expect(calls[1]?.auth).toBe("Bearer brokered-installation-token");
  });

  it("requires GitHub token auth or a Libretto Cloud API key", async () => {
    const debuggerInstance = createPlaywrightDebugger({
      github: {
        owner: "acme",
        repo: "automations",
        baseBranch: "main",
      },
      agent: {
        model: "openai/gpt-5.4",
      },
      fetch: vi.fn() as unknown as typeof fetch,
      modelRunner: async () => ({
        title: "Unused",
        summary: "unused",
        rationale: "unused",
        changes: [],
      }),
    });

    await expect(
      debuggerInstance.debugPlaywrightFailure(createError(), createPage()),
    ).resolves.toMatchObject({
      status: "debugger_failed",
      error: expect.stringContaining("GitHub authentication is missing"),
    });
  });

  it("does not replace the original automation error or prevent fallback logic", async () => {
    const debuggerInstance = createPlaywrightDebugger({
      github: {
        owner: "acme",
        repo: "automations",
        baseBranch: "main",
        token: "ghs_test",
      },
      agent: { model: "openai/gpt-5.4" },
      fetch: (async () =>
        jsonResponse({ message: "GitHub unavailable" }, { status: 503 })) as typeof fetch,
      modelRunner: async () => ({
        title: "Unused",
        summary: "unused",
        rationale: "unused",
        changes: [],
      }),
    });
    const originalError = createError();
    let fallbackCalled = false;

    const runFailurePath = async () => {
      try {
        throw originalError;
      } catch (error) {
        const debugResult = await debuggerInstance.debugPlaywrightFailure(
          error,
          createPage(),
        );
        expect(debugResult.status).toBe("debugger_failed");
        fallbackCalled = true;
        throw error;
      }
    };

    await expect(runFailurePath()).rejects.toBe(originalError);
    expect(fallbackCalled).toBe(true);
  });

  it("rejects unsafe paths returned by the agent", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = url.toString();
      if (requestUrl.endsWith("/git/ref/heads/main")) {
        return jsonResponse({ object: { sha: "base-commit" } });
      }
      if (requestUrl.endsWith("/git/commits/base-commit")) {
        return jsonResponse({ sha: "base-commit", tree: { sha: "base-tree" } });
      }
      if (requestUrl.includes("/contents/src/workflow.ts?ref=main")) {
        return jsonResponse({
          type: "file",
          encoding: "base64",
          content: Buffer.from("old").toString("base64"),
        });
      }
      return jsonResponse({ message: "not found" }, { status: 404 });
    }) as unknown as typeof fetch;

    const debuggerInstance = createPlaywrightDebugger({
      github: {
        owner: "acme",
        repo: "automations",
        baseBranch: "main",
        token: "ghs_test",
        repositoryRoot: "/repo",
      },
      agent: {
        model: "openai/gpt-5.4",
      },
      fetch: fetchImpl,
      modelRunner: async () => ({
        title: "Unsafe",
        summary: "Unsafe",
        rationale: "Unsafe",
        changes: [{ path: "../secret.ts", content: "" }],
      }),
    });

    await expect(
      debuggerInstance.debugPlaywrightFailure(createError(), createPage()),
    ).resolves.toMatchObject({
      status: "debugger_failed",
      error: expect.stringContaining("Unsafe repository path"),
    });
  });
});
