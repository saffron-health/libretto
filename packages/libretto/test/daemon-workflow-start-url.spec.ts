import { describe, expect, it } from "vitest";
import { applyWorkflowStartUrlToBrowserConfig } from "../src/cli/core/daemon/config.js";

describe("applyWorkflowStartUrlToBrowserConfig", () => {
  it("copies startUrl onto connect initialUrl for CDP workflow runs", () => {
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
      initialUrl: "https://example.com/start",
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

  it("does not overwrite an explicit initialUrl", () => {
    expect(
      applyWorkflowStartUrlToBrowserConfig(
        {
          kind: "connect",
          cdpEndpoint: "http://127.0.0.1:9222/",
          initialUrl: "https://example.com/explicit",
        },
        "https://example.com/start",
      ),
    ).toEqual({
      kind: "connect",
      cdpEndpoint: "http://127.0.0.1:9222/",
      initialUrl: "https://example.com/explicit",
    });
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
