import { describe, expect, it } from "vitest";
import {
  browserViewAction,
  shouldRefreshBrowserView,
} from "./browserView.js";

describe("browser view actions", () => {
  it("switches a stale live link to the recording when the API provides one", () => {
    expect(
      browserViewAction({
        live_view_url: "https://provider.example/live",
        recording_url: "https://api.example/recording",
      }),
    ).toEqual({
      label: "Recording",
      url: "https://api.example/recording",
    });
  });

  it("keeps refreshing while a job or its browser session is active", () => {
    expect(shouldRefreshBrowserView({ status: "running" })).toBe(true);
    expect(
      shouldRefreshBrowserView({
        status: "failed",
        browser_session_status: "preserved",
      }),
    ).toBe(true);
    expect(
      shouldRefreshBrowserView({
        status: "completed",
        browser_session_status: "closed",
      }),
    ).toBe(false);
  });
});
