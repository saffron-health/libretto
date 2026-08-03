import { describe, expect, it } from "vitest";
import {
  applyWorkflowStartUrlToBrowserConfig,
  parseConnectPageIndex,
} from "../src/cli/core/daemon/config.js";

describe("applyWorkflowStartUrlToBrowserConfig", () => {
  it("does not copy startUrl onto connect initialUrl for CDP workflow runs", () => {
    expect(
      applyWorkflowStartUrlToBrowserConfig(
        {
          kind: "connect",
          cdpEndpoint: "http://127.0.0.1:9222/",
        },
        "https://example.com/start",
      ),
    ).toEqual({
      kind: "connect",
      cdpEndpoint: "http://127.0.0.1:9222/",
    });
  });

  it("copies startUrl onto launch initialUrl", () => {
    expect(
      applyWorkflowStartUrlToBrowserConfig(
        {
          kind: "launch",
          headed: false,
          viewport: { width: 1366, height: 768 },
        },
        "https://example.com/start",
      ),
    ).toEqual({
      kind: "launch",
      headed: false,
      viewport: { width: 1366, height: 768 },
      initialUrl: "https://example.com/start",
    });
  });

  it("does not overwrite an explicit launch initialUrl", () => {
    expect(
      applyWorkflowStartUrlToBrowserConfig(
        {
          kind: "launch",
          headed: false,
          viewport: { width: 1366, height: 768 },
          initialUrl: "https://example.com/explicit",
        },
        "https://example.com/start",
      ),
    ).toEqual({
      kind: "launch",
      headed: false,
      viewport: { width: 1366, height: 768 },
      initialUrl: "https://example.com/explicit",
    });
  });

  it("leaves connect configs unchanged when startUrl is missing", () => {
    const connect = {
      kind: "connect" as const,
      cdpEndpoint: "http://127.0.0.1:9222/",
    };
    expect(applyWorkflowStartUrlToBrowserConfig(connect, undefined)).toBe(
      connect,
    );
  });

  it("leaves launch configs unchanged when startUrl is missing", () => {
    const launch = {
      kind: "launch" as const,
      headed: false,
      viewport: { width: 1366, height: 768 },
    };
    expect(applyWorkflowStartUrlToBrowserConfig(launch, undefined)).toBe(
      launch,
    );
  });

  it("leaves provider configs unchanged", () => {
    const provider = {
      kind: "provider" as const,
      providerName: "kernel",
      headless: true,
    };
    expect(
      applyWorkflowStartUrlToBrowserConfig(provider, "https://example.com/start"),
    ).toBe(provider);
  });
});

describe("parseConnectPageIndex", () => {
  it("parses page-N and bare numeric ids", () => {
    expect(parseConnectPageIndex("page-0")).toBe(0);
    expect(parseConnectPageIndex("page-2")).toBe(2);
    expect(parseConnectPageIndex("1")).toBe(1);
  });

  it("rejects non-index page ids", () => {
    expect(parseConnectPageIndex("page-ab")).toBeUndefined();
    expect(parseConnectPageIndex("MISSING")).toBeUndefined();
  });
});
