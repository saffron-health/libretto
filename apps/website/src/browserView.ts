export type BrowserViewFields = {
  live_view_url: string | null;
  recording_url: string | null;
};

export function browserViewAction(
  row: BrowserViewFields,
): { label: "Live view" | "Recording"; url: string } | null {
  if (row.recording_url) {
    return { label: "Recording", url: row.recording_url };
  }
  if (row.live_view_url) {
    return { label: "Live view", url: row.live_view_url };
  }
  return null;
}

export function isTerminalBrowserSessionStatus(
  status: string | null,
): boolean {
  return status === "closed" || status === "unknown";
}

export function shouldRefreshBrowserView(row: {
  status: string;
  browser_session_status?: string | null;
}): boolean {
  if (["queued", "starting_browser", "running"].includes(row.status)) {
    return true;
  }
  return Boolean(
    row.browser_session_status &&
      !isTerminalBrowserSessionStatus(row.browser_session_status),
  );
}
