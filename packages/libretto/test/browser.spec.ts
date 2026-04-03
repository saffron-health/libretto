import { afterEach, describe, expect, test, vi } from "vitest";
import { normalizeDomain, normalizeUrl } from "../src/cli/core/browser.js";
import { resolveProviderName } from "../src/cli/core/providers/index.js";
import * as configModule from "../src/cli/core/config.js";

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

describe("resolveProviderName precedence", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  test("defaults to 'local' when nothing is set", () => {
    delete process.env.LIBRETTO_PROVIDER;
    vi.spyOn(configModule, "readLibrettoConfig").mockReturnValue({
      version: 1,
    });
    expect(resolveProviderName()).toBe("local");
  });

  test("CLI flag wins over env var and config", () => {
    process.env.LIBRETTO_PROVIDER = "browserbase";
    vi.spyOn(configModule, "readLibrettoConfig").mockReturnValue({
      version: 1,
      provider: "browserbase",
    });
    expect(resolveProviderName("kernel")).toBe("kernel");
  });

  test("env var wins over config", () => {
    process.env.LIBRETTO_PROVIDER = "kernel";
    vi.spyOn(configModule, "readLibrettoConfig").mockReturnValue({
      version: 1,
      provider: "browserbase",
    });
    expect(resolveProviderName()).toBe("kernel");
  });

  test("config file is used when no flag or env var", () => {
    delete process.env.LIBRETTO_PROVIDER;
    vi.spyOn(configModule, "readLibrettoConfig").mockReturnValue({
      version: 1,
      provider: "browserbase",
    });
    expect(resolveProviderName()).toBe("browserbase");
  });

  test("throws on invalid provider name", () => {
    expect(() => resolveProviderName("invalid")).toThrow(
      /Invalid provider "invalid"/,
    );
  });
});
