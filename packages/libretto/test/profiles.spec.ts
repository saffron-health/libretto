import { describe, expect, it } from "vitest";
import { normalizeProfileName } from "../src/cli/core/profiles.js";
import {
  mergeAuthProfileStorageState,
  type AuthProfileStorageState,
} from "../src/shared/workflow/auth-profile-state.js";

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

describe("auth profile storage refresh", () => {
  it("replaces only visited-site state and preserves unrelated profile state", () => {
    const existing: AuthProfileStorageState = {
      sites: ["old.example.com"],
      cookies: [
        cookie("old.example.com", "old", "keep"),
        cookie(".twitter.com", "session", "stale"),
      ],
      origins: [
        origin("https://old.example.com", "token", "keep"),
        origin("https://twitter.com", "token", "stale"),
      ],
    };
    const latest: AuthProfileStorageState = {
      cookies: [
        cookie(".twitter.com", "session", "fresh"),
        cookie("api.twitter.com", "api", "fresh"),
        cookie("other.example.com", "other", "skip"),
      ],
      origins: [
        origin("https://twitter.com", "token", "fresh"),
        origin("https://other.example.com", "other", "skip"),
      ],
    };

    const merged = mergeAuthProfileStorageState(existing, latest, [
      "https://twitter.com/home",
    ]);

    expect(merged.sites).toEqual(["old.example.com", "twitter.com"]);
    expect(merged.cookies).toEqual([
      cookie("old.example.com", "old", "keep"),
      cookie(".twitter.com", "session", "fresh"),
      cookie("api.twitter.com", "api", "fresh"),
    ]);
    expect(merged.origins).toEqual([
      origin("https://old.example.com", "token", "keep"),
      origin("https://twitter.com", "token", "fresh"),
    ]);
  });
});

function cookie(domain: string, name: string, value: string): unknown {
  return {
    domain,
    expires: -1,
    httpOnly: true,
    name,
    path: "/",
    sameSite: "Lax",
    secure: true,
    value,
  };
}

function origin(
  originUrl: string,
  name: string,
  value: string,
): NonNullable<AuthProfileStorageState["origins"]>[number] {
  return {
    origin: originUrl,
    localStorage: [{ name, value }],
    indexedDB: [{ name: "db", stores: [] }],
  };
}
