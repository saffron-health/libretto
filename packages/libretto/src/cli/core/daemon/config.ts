/**
 * Configuration types for the browser daemon process.
 *
 * Serialized as JSON in `process.argv[2]` when spawning the daemon.
 */

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
};

export type DaemonWorkflowConfig = {
  integrationPath: string;
  params?: unknown;
  visualize?: boolean;
  stayOpenOnSuccess?: boolean;
  tsconfigPath?: string;
  authProfileDomain?: string;
};

export type DaemonConfig = {
  session: string;
  browser: DaemonBrowserLaunchConfig | DaemonBrowserConnectConfig;
  workflow?: DaemonWorkflowConfig;
};
