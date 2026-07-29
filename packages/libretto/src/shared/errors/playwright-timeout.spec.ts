import { errors } from "playwright";
import { describe, expect, it } from "vitest";
import {
  enrichPlaywrightTimeoutMessage,
  formatPlaywrightErrorMessage,
  isPlaywrightTimeoutError,
} from "./playwright-timeout.js";

const OVERLAY_CLICK_TIMEOUT = `
locator.click: Timeout 800ms exceeded.
Call log:
  - waiting for locator('#t')
  - attempting click action
      - <div id="overlay"></div> intercepts pointer events
`.trim();

describe("playwright timeout enrichment", () => {
  it("detects TimeoutError via instanceof errors.TimeoutError", () => {
    expect(
      isPlaywrightTimeoutError(new errors.TimeoutError("Timeout 1ms exceeded.")),
    ).toBe(true);
  });

  it("promotes Call-log intercept reasons into the headline for CLI agents", () => {
    const enriched = enrichPlaywrightTimeoutMessage(OVERLAY_CLICK_TIMEOUT);
    expect(enriched.split("\n")[0]).toBe(
      'locator.click: Timeout 800ms exceeded. <div id="overlay"></div> intercepts pointer events — run libretto snapshot and interact with the covering element (modal/overlay), then retry.',
    );
  });

  it("formats TimeoutError-shaped messages through formatPlaywrightErrorMessage", () => {
    const error = new errors.TimeoutError(OVERLAY_CLICK_TIMEOUT);
    expect(formatPlaywrightErrorMessage(error).split("\n")[0]).toContain(
      "intercepts pointer events — run libretto snapshot",
    );
  });
});
