/**
 * Spawn and wait for a browser daemon process.
 *
 * Shared by `runOpen`, `runConnect`, and `runOpenWithProvider` in
 * `browser.ts`. Encapsulates the child-process lifecycle and IPC
 * readiness polling so callers only need to provide config and
 * handle session-state persistence.
 */

import { openSync, closeSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import type { LoggerApi } from "../../../shared/logger/index.js";
import { getDaemonSocketPath } from "./ipc.js";
import { DaemonClient } from "./ipc.js";
import type { DaemonConfig } from "./config.js";

// ── Public types ─────────────────────────────────────────────────────

export type SpawnSessionDaemonOptions = {
  /** Daemon config — serialized as JSON and passed to the child process. */
  config: DaemonConfig;
  session: string;
  logger: LoggerApi;
  /** Path for the child's stderr log file. */
  logPath: string;
  /** How long to wait for the daemon's IPC server (default: 10 000 ms). */
  ipcTimeoutMs?: number;
  /**
   * Called before throwing when the daemon fails to start (spawn error,
   * early exit, or IPC timeout). Use for cleanup — e.g. closing a cloud
   * provider session. Return value is ignored.
   */
  onFailure?: () => Promise<unknown>;
};

export type SpawnSessionDaemonResult = {
  /** PID of the detached daemon child process. */
  pid: number;
  /** Unix domain socket path for daemon IPC. */
  socketPath: string;
  /** Ready-to-use IPC client (already confirmed reachable via ping). */
  client: DaemonClient;
};

// ── Implementation ───────────────────────────────────────────────────

const DEFAULT_IPC_TIMEOUT_MS = 10_000;
const IPC_POLL_INTERVAL_MS = 250;

/**
 * Spawn a daemon child process with the given config and wait for its
 * IPC server to become reachable.
 *
 * The daemon entry point is resolved relative to this module so the
 * caller doesn't need to know where the daemon script lives.
 */
export async function spawnSessionDaemon(
  options: SpawnSessionDaemonOptions,
): Promise<SpawnSessionDaemonResult> {
  const {
    config,
    session,
    logger,
    logPath,
    ipcTimeoutMs = DEFAULT_IPC_TIMEOUT_MS,
    onFailure,
  } = options;

  // Resolve paths for the daemon entry point and tsx loader.
  const daemonEntryPath = fileURLToPath(
    new URL("./daemon.js", import.meta.url),
  );
  const require = createRequire(import.meta.url);
  const tsxImportPath = pathToFileURL(require.resolve("tsx/esm")).href;

  // Spawn detached child process with stderr going to the log file.
  const childStderrFd = openSync(logPath, "a");
  const child = spawn(
    process.execPath,
    ["--import", tsxImportPath, daemonEntryPath, JSON.stringify(config)],
    {
      detached: true,
      stdio: ["ignore", "ignore", childStderrFd],
    },
  );
  child.unref();
  closeSync(childStderrFd);

  const pid = child.pid!;
  logger.info("daemon-spawned", { pid, session });

  // Track spawn errors and early exits so the polling loop can fail fast.
  let childSpawnError: Error | null = null;
  let childEarlyExit: {
    code: number | null;
    signal: NodeJS.Signals | null;
  } | null = null;

  child.on("error", (err) => {
    childSpawnError = err;
    logger.error("daemon-spawn-error", { error: err, session });
  });

  child.on("exit", (code, signal) => {
    childEarlyExit = { code, signal };
    logger.warn("daemon-early-exit", { code, signal, session, pid });
  });

  // Poll the daemon's IPC server until it responds to a ping.
  const socketPath = getDaemonSocketPath(session);
  const client = new DaemonClient(socketPath);
  const maxAttempts = Math.ceil(ipcTimeoutMs / IPC_POLL_INTERVAL_MS);
  let ipcReady = false;

  for (let i = 0; i < maxAttempts; i++) {
    // Fail fast on spawn errors. The cast is needed because TypeScript
    // doesn't track that the variable is mutated asynchronously by the
    // child's "error" event handler.
    const spawnError = childSpawnError as Error | null;
    if (spawnError !== null) {
      await onFailure?.();
      const errWithCode = spawnError as Error & { code?: string };
      const hint =
        errWithCode.code === "ENOENT"
          ? " Ensure Node.js is available in PATH for child processes."
          : "";
      throw new Error(
        `Failed to spawn daemon: ${spawnError.message}.${hint} Check logs: ${logPath}`,
      );
    }

    // Fail fast on early exit.
    const earlyExit = childEarlyExit as {
      code: number | null;
      signal: NodeJS.Signals | null;
    } | null;
    if (earlyExit !== null) {
      await onFailure?.();
      const status = earlyExit.code ?? earlyExit.signal ?? "unknown";
      throw new Error(
        `Daemon exited before startup (status: ${status}). Check logs: ${logPath}`,
      );
    }

    await new Promise((r) => setTimeout(r, IPC_POLL_INTERVAL_MS));
    ipcReady = await client.ping();
    if (ipcReady) break;

    if (i > 0 && i % 10 === 0) {
      logger.info("daemon-waiting-for-ipc", { attempt: i, session });
    }
  }

  if (!ipcReady) {
    // Kill the orphaned daemon process before reporting failure.
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have already exited.
    }
    await onFailure?.();
    throw new Error(
      `Daemon failed to start within ${Math.ceil(ipcTimeoutMs / 1000)}s. Check logs: ${logPath}`,
    );
  }

  logger.info("daemon-ipc-ready", { session, socketPath });
  return { pid, socketPath, client };
}
