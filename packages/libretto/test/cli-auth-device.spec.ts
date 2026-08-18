import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn((_command: string, _args: string[]) => ({
    on: vi.fn(),
    unref: vi.fn(),
  })),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../src/cli/core/auth-fetch.js", () => ({
  orpcCall: vi.fn(),
  betterAuthCall: vi.fn(),
  resolveHostedApiUrl: () => "https://api.libretto.test",
  resolveApiUrl: vi.fn(),
  pickCredential: vi.fn(),
  NOT_AUTHENTICATED_MESSAGE: "not authenticated",
}));

vi.mock("../src/cli/core/auth-storage.js", () => ({
  writeAuthState: vi.fn(),
  readAuthState: vi.fn(),
  clearAuthState: vi.fn(),
  authStatePath: () => "/tmp/auth.json",
}));

import { orpcCall, betterAuthCall } from "../src/cli/core/auth-fetch.js";
import { writeAuthState } from "../src/cli/core/auth-storage.js";
import {
  buildBrowserLoginUrl,
  formatDeviceAuthPrompt,
  runBrowserAuthFlow,
  runDeviceAuthFlow,
} from "../src/cli/commands/auth.js";

const loginCreate = {
  requestId: "request-1",
  secret: "s".repeat(32),
  userCode: "WDJB-MJHT",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

const approved = {
  status: "approved" as const,
  cookieHeader: "better-auth.session_token=session-token",
  userId: "user-1",
  email: "user@example.com",
  emailVerified: true,
  sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
};

const sessionResponse = {
  data: {
    user: { id: "user-1", email: "user@example.com", emailVerified: true },
    session: { id: "session-1", expiresAt: approved.sessionExpiresAt },
  },
  setCookie: [] as string[],
};

describe("CLI browser login URLs", () => {
  it("keeps the default login URL on /signin with cliLoginId and cliLoginSecret", () => {
    const url = buildBrowserLoginUrl({
      websiteUrl: "https://libretto.sh",
      requestId: "request-1",
      secret: "s".repeat(32),
      mode: "login",
    });
    expect(url.pathname).toBe("/signin");
    expect(url.searchParams.get("cliLoginId")).toBe("request-1");
    expect(url.searchParams.get("cliLoginSecret")).toBe("s".repeat(32));
    expect(url.toString()).not.toContain("/device");
  });
});

describe("device-auth prompt", () => {
  it("prints the Codex-shaped device URL and user code without the CLI secret", () => {
    const prompt = formatDeviceAuthPrompt({
      mode: "login",
      deviceUrl: "https://libretto.sh/device",
      userCode: "WDJB-MJHT",
    });
    expect(prompt).toContain("https://libretto.sh/device");
    expect(prompt).toContain("WDJB-MJHT");
    expect(prompt).toContain("expires in 10 minutes");
    expect(prompt).toContain("If a website or another person gave you this code, cancel.");
    expect(prompt).not.toContain("cliLoginSecret");
    expect(prompt).not.toContain("cliLoginId");
  });

  it("uses sign-up wording when mode is signup", () => {
    const prompt = formatDeviceAuthPrompt({
      mode: "signup",
      deviceUrl: "https://libretto.sh/device?mode=signup",
      userCode: "WDJB-MJHT",
    });
    expect(prompt).toContain("sign up for Libretto Cloud");
    expect(prompt).toContain("started this sign-up in the Libretto CLI");
  });
});

describe("CLI login flows", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    spawnMock.mockReset();
    spawnMock.mockImplementation((_command: string, _args: string[]) => ({
      on: vi.fn(),
      unref: vi.fn(),
    }));
    vi.mocked(orpcCall).mockReset();
    vi.mocked(betterAuthCall).mockReset();
    vi.mocked(writeAuthState).mockReset();
  });

  it("opens the current /signin handoff for default login", async () => {
    vi.mocked(orpcCall)
      .mockResolvedValueOnce(loginCreate)
      .mockResolvedValueOnce(approved);
    vi.mocked(betterAuthCall).mockResolvedValue(sessionResponse);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runBrowserAuthFlow({
      mode: "login",
      apiUrl: "https://api.libretto.test",
      websiteUrl: "https://libretto.sh",
    });

    expect(spawnMock).toHaveBeenCalled();
    const openedUrl = String(spawnMock.mock.calls[0]?.[1]?.[0] ?? "");
    expect(openedUrl).toContain("/signin?");
    expect(openedUrl).toContain("cliLoginId=request-1");
    expect(openedUrl).toContain("cliLoginSecret=");
    expect(openedUrl).not.toContain("/device");
    expect(writeAuthState).toHaveBeenCalledOnce();
    expect(orpcCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "/v1/auth/cliLoginPoll",
        input: {
          requestId: "request-1",
          secret: "s".repeat(32),
        },
      }),
    );
  });

  it("still completes default login when create omits userCode", async () => {
    vi.mocked(orpcCall)
      .mockResolvedValueOnce({
        requestId: "request-1",
        secret: "s".repeat(32),
        expiresAt: loginCreate.expiresAt,
      })
      .mockResolvedValueOnce(approved);
    vi.mocked(betterAuthCall).mockResolvedValue(sessionResponse);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runBrowserAuthFlow({
      mode: "login",
      apiUrl: "https://api.libretto.test",
      websiteUrl: "https://libretto.sh",
    });

    expect(spawnMock).toHaveBeenCalled();
    expect(writeAuthState).toHaveBeenCalledOnce();
  });

  it("hints at --device-auth when the default path cannot open a browser", async () => {
    spawnMock.mockImplementation(() => {
      throw new Error("no display");
    });
    vi.mocked(orpcCall)
      .mockResolvedValueOnce(loginCreate)
      .mockResolvedValueOnce(approved);
    vi.mocked(betterAuthCall).mockResolvedValue(sessionResponse);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    await runBrowserAuthFlow({
      mode: "login",
      apiUrl: "https://api.libretto.test",
      websiteUrl: "https://libretto.sh",
    });

    expect(logs.join("\n")).toContain(
      "On a remote or headless machine? Use `libretto cloud auth login --device-auth` instead.",
    );
  });

  it("prints /device and the user code for --device-auth without opening a browser", async () => {
    vi.mocked(orpcCall)
      .mockResolvedValueOnce(loginCreate)
      .mockResolvedValueOnce(approved);
    vi.mocked(betterAuthCall).mockResolvedValue(sessionResponse);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    await runDeviceAuthFlow({
      mode: "login",
      apiUrl: "https://api.libretto.test",
      websiteUrl: "https://libretto.sh",
    });

    const output = logs.join("\n");
    expect(spawnMock).not.toHaveBeenCalled();
    expect(output).toContain("https://libretto.sh/device");
    expect(output).toContain("WDJB-MJHT");
    expect(output).not.toContain("cliLoginSecret");
    expect(writeAuthState).toHaveBeenCalledOnce();
    expect(orpcCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "/v1/auth/cliLoginPoll",
        input: {
          requestId: "request-1",
          secret: "s".repeat(32),
        },
      }),
    );
  });

  it("prints /device?mode=signup for signup --device-auth", async () => {
    vi.mocked(orpcCall)
      .mockResolvedValueOnce(loginCreate)
      .mockResolvedValueOnce(approved);
    vi.mocked(betterAuthCall).mockResolvedValue(sessionResponse);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    await runDeviceAuthFlow({
      mode: "signup",
      apiUrl: "https://api.libretto.test",
      websiteUrl: "https://libretto.sh",
    });

    const output = logs.join("\n");
    expect(spawnMock).not.toHaveBeenCalled();
    expect(output).toContain("https://libretto.sh/device?mode=signup");
    expect(output).toContain("sign up for Libretto Cloud");
  });

  it("fails --device-auth when the API omits userCode", async () => {
    vi.mocked(orpcCall).mockResolvedValueOnce({
      requestId: "request-1",
      secret: "s".repeat(32),
      expiresAt: loginCreate.expiresAt,
    });

    await expect(
      runDeviceAuthFlow({
        mode: "login",
        apiUrl: "https://api.libretto.test",
        websiteUrl: "https://libretto.sh",
      }),
    ).rejects.toThrow(/does not support device code login/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
