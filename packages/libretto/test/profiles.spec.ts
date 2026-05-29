import { describe, expect, it } from "vitest";
import { normalizeProfileName } from "../src/cli/core/profiles.js";

describe("auth profile names", () => {
  it("accepts user-chosen profile aliases", () => {
    expect(normalizeProfileName("twitter")).toBe("twitter");
    expect(normalizeProfileName("twitter-2")).toBe("twitter-2");
    expect(normalizeProfileName("twitter.prod")).toBe("twitter.prod");
  });

  it("rejects path-like profile names", () => {
    expect(() => normalizeProfileName("../twitter")).toThrow("Invalid profile name");
    expect(() => normalizeProfileName("twitter/key")).toThrow("Invalid profile name");
  });
});
