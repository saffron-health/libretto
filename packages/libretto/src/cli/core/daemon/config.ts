/**
 * Configuration types for the browser daemon process.
 *
 * Serialized as JSON in `process.argv[2]` when spawning the daemon.
 */

/**
 * Config for daemon-managed browser launch (`libretto open`).
 * The daemon owns the browser lifecycle and will close it on shutdown.
 */
export type DaemonLaunchConfig = {
  port: number;
  url: string;
  session: string;
  headed: boolean;
  viewport: { width: number; height: number };
  storageStatePath?: string;
  windowPosition?: { x: number; y: number };
};

/**
 * Config for connecting to an externally managed browser (`libretto connect`).
 * The daemon borrows the CDP connection and will disconnect (not close) on
 * shutdown — the browser outlives the session.
 */
export type DaemonConnectConfig = {
  mode: "connect";
  session: string;
  cdpEndpoint: string;
  /** If set, the daemon navigates to this URL after connecting. */
  url?: string;
};

/**
 * Discriminated union passed as JSON in `process.argv[2]`.
 * Launch configs omit `mode` for backward compatibility with existing
 * `runOpen()` callers — any config without `mode: "connect"` is treated
 * as a launch config.
 */
export type DaemonConfig = DaemonLaunchConfig | DaemonConnectConfig;

export function isConnectConfig(
  config: DaemonConfig,
): config is DaemonConnectConfig {
  return "mode" in config && config.mode === "connect";
}
