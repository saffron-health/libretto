/**
 * Configuration types for the browser daemon process.
 *
 * Serialized as JSON in `process.argv[2]` when spawning the daemon.
 */

import type { Experiments } from "../experiments.js";

/**
 * Config for daemon-managed browser launch (`libretto open`).
 * The daemon owns the browser lifecycle and will close it on shutdown.
 */
export type DaemonBrowserLaunchConfig = {
  kind: "launch";
  headed: boolean;
  viewport: { width: number; height: number };
  storageStatePath?: string;
  windowPosition?: { x: number; y: number };
  remoteDebuggingPort?: number;
  initialUrl?: string;
};

/**
 * Config for connecting to an externally managed browser (`libretto connect`).
 * The daemon borrows the CDP connection and will disconnect (not close) on
 * shutdown — the browser outlives the session.
 */
export type DaemonBrowserConnectConfig = {
  kind: "connect";
  cdpEndpoint: string;
  initialUrl?: string;
  /** Target page id (`page-0`, `page-1`, …) among pages discovered at connect. */
  pageId?: string;
};

/**
 * Config for a daemon-owned cloud browser provider. The daemon creates the
 * provider session during startup, connects over CDP, and closes the provider
 * session during daemon shutdown.
 */
export type DaemonBrowserProviderConfig = {
  kind: "provider";
  providerName: string;
  headless?: boolean;
  initialUrl?: string;
  // Preferred start URL for providers that preload before CDP attach.
  // Falls back to initialUrl when unset.
  startUrl?: string;
  gpu?: boolean;
  viewport?: { width: number; height: number };
  authProfileName?: string;
  authProfilePersist?: boolean;
};

export type DaemonWorkflowConfig = {
  integrationPath: string;
  params?: unknown;
  visualize?: boolean;
  stayOpenOnSuccess?: boolean;
  tsconfigPath?: string;
  authProfileName?: string;
  authProfilePersist?: boolean;
};

export type DaemonConfig = {
  session: string;
  experiments: Experiments;
  browser:
    | DaemonBrowserLaunchConfig
    | DaemonBrowserConnectConfig
    | DaemonBrowserProviderConfig;
  workflow?: DaemonWorkflowConfig;
};

/**
 * Copy workflow `startUrl` onto launch/connect `initialUrl` when the CLI did
 * not already set one. Provider configs use a separate `startUrl` field.
 */
export function applyWorkflowStartUrlToBrowserConfig(
  browser: DaemonConfig["browser"],
  startUrl: string | undefined,
): DaemonConfig["browser"] {
  if (
    !startUrl ||
    (browser.kind !== "launch" && browser.kind !== "connect") ||
    browser.initialUrl
  ) {
    return browser;
  }
  return { ...browser, initialUrl: startUrl };
}

/**
 * Resolve a connect-time `--page` id to an index among discovered pages.
 * Accepts `page-0` / `page-1` (stable initial ids) or bare `0` / `1`.
 */
export function parseConnectPageIndex(pageId: string): number | undefined {
  const match = /^(?:page-)?(\d+)$/.exec(pageId);
  if (!match) return undefined;
  return Number(match[1]);
}
