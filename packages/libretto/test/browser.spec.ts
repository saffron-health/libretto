import { describe, expect } from "vitest";
import { normalizeDomain, normalizeUrl } from "../src/cli/core/browser.js";
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

  test("normalizes www hostnames from parsed URLs", () => {
    expect(normalizeDomain(normalizeUrl("https://www.example.com/path"))).toBe(
      "example.com",
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

  test("LIBRETTO_PROVIDER env var rejects invalid values", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("open https://example.com", {
      LIBRETTO_PROVIDER: "invalid",
    });
    expect(result.stderr).toContain('Invalid provider "invalid"');
    expect(result.stderr).toContain("LIBRETTO_PROVIDER env var");
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
