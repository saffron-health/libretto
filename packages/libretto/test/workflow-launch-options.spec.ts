import { describe, expect, it } from "vitest";
import { mergeWorkflowLaunchIntoProviderConfig } from "../src/cli/core/daemon/config.js";

describe("mergeWorkflowLaunchIntoProviderConfig", () => {
  it("promotes workflow startUrl, gpu, and viewport onto provider config", () => {
    expect(
      mergeWorkflowLaunchIntoProviderConfig(
        {
          kind: "provider",
          providerName: "kernel",
          headless: true,
        },
        {
          startUrl: "https://www.marriott.com/",
          gpu: true,
          viewport: { width: 1440, height: 900 },
        },
      ),
    ).toEqual({
      kind: "provider",
      providerName: "kernel",
      headless: true,
      startUrl: "https://www.marriott.com/",
      gpu: true,
      viewport: { width: 1440, height: 900 },
    });
  });

  it("prefers explicit CLI viewport over workflow viewport", () => {
    expect(
      mergeWorkflowLaunchIntoProviderConfig(
        {
          kind: "provider",
          providerName: "kernel",
          headless: true,
          viewport: { width: 1280, height: 720 },
        },
        {
          startUrl: "https://example.com/",
          viewport: { width: 1440, height: 900 },
        },
      ),
    ).toMatchObject({
      startUrl: "https://example.com/",
      viewport: { width: 1280, height: 720 },
    });
  });
});
