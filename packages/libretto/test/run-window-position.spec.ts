import { describe, expect, it } from "vitest";
import { createRunBrowserConfig } from "../src/cli/commands/execution.js";

describe("createRunBrowserConfig", () => {
  it("passes window position through to headed local workflow runs", () => {
    expect(
      createRunBrowserConfig({
        headless: false,
        viewport: { width: 1440, height: 900 },
        windowPosition: { x: 536, y: 33 },
      }),
    ).toEqual({
      kind: "launch",
      headed: true,
      viewport: { width: 1440, height: 900 },
      windowPosition: { x: 536, y: 33 },
    });
  });

  it("does not pass window position to headless local workflow runs", () => {
    expect(
      createRunBrowserConfig({
        headless: true,
        windowPosition: { x: 536, y: 33 },
      }),
    ).toEqual({
      kind: "launch",
      headed: false,
      viewport: { width: 1366, height: 768 },
    });
  });

  it("does not pass window position to provider workflow runs", () => {
    expect(
      createRunBrowserConfig({
        providerName: "kernel",
        headless: true,
        windowPosition: { x: 536, y: 33 },
      }),
    ).toEqual({
      kind: "provider",
      providerName: "kernel",
    });
  });
});
