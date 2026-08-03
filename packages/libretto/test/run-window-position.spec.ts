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
      headless: true,
    });
  });

  it("passes viewport through to provider workflow runs", () => {
    expect(
      createRunBrowserConfig({
        providerName: "kernel",
        headless: true,
        viewport: { width: 1440, height: 900 },
      }),
    ).toEqual({
      kind: "provider",
      providerName: "kernel",
      headless: true,
      viewport: { width: 1440, height: 900 },
    });
  });

  it("omits viewport on provider runs when none is explicit", () => {
    expect(
      createRunBrowserConfig({
        providerName: "browserbase",
        headless: true,
      }),
    ).toEqual({
      kind: "provider",
      providerName: "browserbase",
      headless: true,
    });
  });

  it("passes headed mode to provider workflow runs", () => {
    expect(
      createRunBrowserConfig({
        providerName: "kernel",
        headless: false,
        windowPosition: { x: 536, y: 33 },
      }),
    ).toEqual({
      kind: "provider",
      providerName: "kernel",
      headless: false,
    });
  });

  it("uses connect config for CDP workflow runs", () => {
    expect(
      createRunBrowserConfig({
        cdpEndpoint: "http://127.0.0.1:9222/",
        headless: true,
        viewport: { width: 1440, height: 900 },
        windowPosition: { x: 536, y: 33 },
        providerName: "kernel",
      }),
    ).toEqual({
      kind: "connect",
      cdpEndpoint: "http://127.0.0.1:9222/",
    });
  });

  it("passes page id through to CDP connect config", () => {
    expect(
      createRunBrowserConfig({
        cdpEndpoint: "http://127.0.0.1:9222/",
        pageId: "page-1",
        headless: true,
      }),
    ).toEqual({
      kind: "connect",
      cdpEndpoint: "http://127.0.0.1:9222/",
      pageId: "page-1",
    });
  });
});
