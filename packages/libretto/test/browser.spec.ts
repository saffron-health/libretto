import { describe, expect, test } from "vitest";
import { normalizeDomain, normalizeUrl } from "../src/cli/core/browser.js";

describe("browser URL normalization", () => {
  test("adds https to bare hostnames", () => {
    expect(normalizeUrl("example.com").href).toBe("https://example.com/");
  });

  test("adds https to bare hosts with ports", () => {
    expect(normalizeUrl("localhost:3000").href).toBe(
      "https://localhost:3000/",
    );
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
