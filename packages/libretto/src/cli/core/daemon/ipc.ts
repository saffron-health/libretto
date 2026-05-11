import { createHash } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { createIpcPeer, type IpcPeer } from "../../../shared/ipc/ipc.js";
import { connectToIpcSocket } from "../../../shared/ipc/socket-transport.js";
import type { LoggerApi } from "../../../shared/logger/index.js";
import type { SnapshotDiff } from "../../../shared/snapshot/diff-snapshots.js";
import type { Snapshot } from "../../../shared/snapshot/types.js";
import { REPO_ROOT } from "../context.js";
import type { WorkflowStatus } from "../workflow-runner/runner.js";
import type { DaemonConfig } from "./config.js";

export type DaemonExecOutput = { stdout: string; stderr: string };

export type DaemonPageSummary = { id: string; url: string; active: boolean };

export type DaemonExecArgs = {
  code: string;
  pageId?: string;
  visualize?: boolean;
};

export type DaemonReadonlyExecArgs = { code: string; pageId?: string };

export type DaemonSnapshotArgs = {
  pageId?: string;
  useCachedSnapshot?: boolean;
};

export type DaemonExecSuccess = {
  result: unknown;
  output?: DaemonExecOutput;
  snapshotDiff?: SnapshotDiff;
};

export type DaemonSnapshotResult = {
  mode: "compact";
  pngPath: string;
  snapshot: Snapshot;
};

export type DaemonCloseResult = { replayUrl?: string };

export type DaemonCommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; output?: DaemonExecOutput };

export type DaemonExecResult = DaemonCommandResult<DaemonExecSuccess>;

export type CliToDaemonApi = {
  ping(): { protocolVersion: number };
  pages(): DaemonPageSummary[];
  exec(args: DaemonExecArgs): DaemonExecResult;
  readonlyExec(args: DaemonReadonlyExecArgs): DaemonExecResult;
  snapshot(args: DaemonSnapshotArgs): DaemonSnapshotResult;
  getWorkflowStatus(): WorkflowStatus;
  resumeWorkflow(): void;
  close(): DaemonCloseResult;
};

export type DaemonToCliApi = {
  workflowOutput(args: { stream: "stdout" | "stderr"; text: string }): void;
  workflowPaused(args: { pausedAt: string; url?: string }): void;
  workflowFinished(
    args:
      | { result: "completed"; completedAt: string }
      | { result: "failed"; message: string; phase: "setup" | "workflow" },
  ): void;
};

function createNoopDaemonToCliHandlers(): DaemonToCliApi {
  return {
    workflowOutput: () => {},
    workflowPaused: () => {},
    workflowFinished: () => {},
  };
}

export class DaemonClientError extends Error {
  constructor(
    message: string,
    readonly output?: DaemonExecOutput,
  ) {
    super(message);
    this.name = "DaemonClientError";
  }
}

export type DaemonReadyMessage = {
  type: "ready";
  socketPath: string;
  provider?: {
    name: string;
    sessionId: string;
    cdpEndpoint: string;
    liveViewUrl?: string;
  };
};

export type DaemonStartupErrorMessage = {
  type: "startup-error";
  message: string;
};

export type DaemonStartupStatusMessage = {
  type: "startup-status";
  message: string;
};

function isDaemonReadyMessage(message: unknown): message is DaemonReadyMessage {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as { type?: unknown; socketPath?: unknown };
  return candidate.type === "ready" && typeof candidate.socketPath === "string";
}

function isDaemonStartupErrorMessage(
  message: unknown,
): message is DaemonStartupErrorMessage {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as { type?: unknown; message?: unknown };
  return (
    candidate.type === "startup-error" && typeof candidate.message === "string"
  );
}

function isDaemonStartupStatusMessage(
  message: unknown,
): message is DaemonStartupStatusMessage {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as { type?: unknown; message?: unknown };
  return (
    candidate.type === "startup-status" && typeof candidate.message === "string"
  );
}

export type DaemonClientSpawnOptions = {
  config: DaemonConfig;
  logger: LoggerApi;
  logPath: string;
  startupTimeoutMs: number;
  handlers?: DaemonToCliApi;
  onFailure?: () => Promise<unknown>;
};

export type DaemonClientSpawnResult = {
  pid: number;
  socketPath: string;
  provider?: DaemonReadyMessage["provider"];
  client: DaemonClient;
};

// ---------------------------------------------------------------------------
// Socket path resolution
// ---------------------------------------------------------------------------

/**
 * Deterministic IPC endpoint for a given session.
 *
 * Unix-like platforms use a socket path in `/tmp` to stay well under the macOS
 * 104-byte Unix socket path limit. Windows uses a named pipe path because
 * filesystem Unix domain socket paths are not portable there.
 *
 * The hash combines `REPO_ROOT`, the session name, and a user key so different
 * repos, sessions, or local users never collide.
 */
export function getDaemonSocketPath(
  session: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const userKey = getDaemonUserKey();
  const hash = createHash("sha256")
    .update(`${REPO_ROOT}:${session}:${userKey}`)
    .digest("hex")
    .slice(0, 12);

  if (platform === "win32") {
    return `\\\\.\\pipe\\libretto-${hash}`;
  }

  return `/tmp/libretto-${userKey}-${hash}.sock`;
}

function getDaemonUserKey(): string {
  if (typeof process.getuid === "function") return String(process.getuid());

  try {
    const info = userInfo();
    if (info.username) return info.username;
  } catch {
    // Fall back below.
  }

  return createHash("sha256").update(homedir()).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// Response data types — maps command name to the shape returned on success
// ---------------------------------------------------------------------------

export type DaemonResultMap = {
  ping: { protocolVersion: number };
  pages: DaemonPageSummary[];
  exec: DaemonExecSuccess;
  "readonly-exec": DaemonExecSuccess;
  snapshot: DaemonSnapshotResult;
};

// ---------------------------------------------------------------------------
// DaemonClient — typed IPC wrapper over the daemon socket
// ---------------------------------------------------------------------------

export class DaemonClient {
  private constructor(private readonly ipc: IpcPeer<CliToDaemonApi>) {}

  static async connect(
    socketPath: string,
    handlers: DaemonToCliApi = createNoopDaemonToCliHandlers(),
  ): Promise<DaemonClient> {
    const transport = await connectToIpcSocket(socketPath);
    return new DaemonClient(
      createIpcPeer<CliToDaemonApi, DaemonToCliApi>(transport, handlers),
    );
  }

  static async spawn(
    options: DaemonClientSpawnOptions,
  ): Promise<DaemonClientSpawnResult> {
    const { config, logger, logPath, startupTimeoutMs, handlers, onFailure } =
      options;
    const { session } = config;

    const daemonEntryPath = fileURLToPath(
      new URL("./daemon.js", import.meta.url),
    );
    const require = createRequire(import.meta.url);
    const tsxCliPath = require.resolve("tsx/cli");

    const childStderrFd = openSync(logPath, "a");
    const child = spawn(
      process.execPath,
      [
        tsxCliPath,
        ...(config.workflow?.tsconfigPath
          ? ["--tsconfig", config.workflow.tsconfigPath]
          : []),
        daemonEntryPath,
        JSON.stringify(config),
      ],
      {
        detached: true,
        stdio: ["ignore", "ignore", childStderrFd, "ipc"],
      },
    );
    closeSync(childStderrFd);

    const pid = child.pid!;
    logger.info("daemon-spawned", { pid, session });

    const readyMessage = await DaemonClient.waitForReadyMessage({
      child,
      timeoutMs: startupTimeoutMs,
      formatTimeoutError: () =>
        new Error(
          `Daemon failed to start within ${Math.ceil(startupTimeoutMs / 1000)}s. Check logs: ${logPath}`,
        ),
      formatSpawnError: (error) => {
        const errWithCode = error as Error & { code?: string };
        const hint =
          errWithCode.code === "ENOENT"
            ? " Ensure Node.js is available in PATH for child processes."
            : "";
        return new Error(
          `Failed to spawn daemon: ${error.message}.${hint} Check logs: ${logPath}`,
        );
      },
      formatExitError: (code, signal) => {
        const status = code ?? signal ?? "unknown";
        return new Error(
          `Daemon exited before startup (status: ${status}). Check logs: ${logPath}`,
        );
      },
      onReady: (message) => {
        logger.info("daemon-ready", {
          session,
          socketPath: message.socketPath,
          pid,
        });
        child.disconnect();
        child.unref();
      },
      onSpawnError: (error) => {
        logger.error("daemon-spawn-error", { error, session });
      },
      onExit: (code, signal, ready) => {
        logger.warn("daemon-exit", { code, signal, session, pid, ready });
      },
      onStatus: (message) => {
        logger.info("daemon-startup-status", {
          session,
          message: message.message,
        });
        console.log(message.message);
      },
    }).catch(async (error: unknown) => {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may have already exited.
      }
      await onFailure?.();
      throw error;
    });

    const client = await DaemonClient.connect(
      readyMessage.socketPath,
      handlers,
    );
    const socketPath = readyMessage.socketPath;
    logger.info("daemon-ipc-ready", { session, socketPath });
    return { pid, socketPath, provider: readyMessage.provider, client };
  }

  static async waitForReadyMessage(args: {
    child: ChildProcess;
    timeoutMs: number;
    formatTimeoutError: () => Error;
    formatSpawnError: (error: Error) => Error;
    formatExitError: (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => Error;
    onReady?: (message: DaemonReadyMessage) => void;
    onSpawnError?: (error: Error) => void;
    onExit?: (
      code: number | null,
      signal: NodeJS.Signals | null,
      ready: boolean,
    ) => void;
    onStatus?: (message: DaemonStartupStatusMessage) => void;
  }): Promise<DaemonReadyMessage> {
    const {
      child,
      timeoutMs,
      formatTimeoutError,
      formatSpawnError,
      formatExitError,
      onReady,
      onSpawnError,
      onExit,
      onStatus,
    } = args;

    return new Promise<DaemonReadyMessage>((resolve, reject) => {
      let ready = false;
      let timeout: ReturnType<typeof setTimeout>;

      const cleanup = (): void => {
        clearTimeout(timeout);
        child.off("message", onMessage);
        child.off("error", onError);
        child.off("exit", onChildExit);
        process.off("SIGINT", onParentSigint);
        process.off("SIGTERM", onParentSigterm);
      };

      const fail = (error: Error): void => {
        cleanup();
        reject(error);
      };

      timeout = setTimeout(() => fail(formatTimeoutError()), timeoutMs);

      const onMessage = (message: unknown): void => {
        if (isDaemonStartupErrorMessage(message)) {
          fail(new Error(message.message));
          return;
        }
        if (isDaemonStartupStatusMessage(message)) {
          onStatus?.(message);
          return;
        }
        if (!isDaemonReadyMessage(message)) return;
        ready = true;
        cleanup();
        onReady?.(message);
        resolve(message);
      };

      const onError = (error: Error): void => {
        onSpawnError?.(error);
        fail(formatSpawnError(error));
      };

      const onChildExit = (
        code: number | null,
        signal: NodeJS.Signals | null,
      ): void => {
        onExit?.(code, signal, ready);
        if (ready) return;
        fail(formatExitError(code, signal));
      };

      const forwardSignalToChild = (signal: NodeJS.Signals): void => {
        try {
          child.kill(signal);
        } catch {
          // Child may have already exited.
        }
      };

      const onParentSigint = (): void => forwardSignalToChild("SIGINT");
      const onParentSigterm = (): void => forwardSignalToChild("SIGTERM");

      child.on("message", onMessage);
      child.on("error", onError);
      child.on("exit", onChildExit);
      process.once("SIGINT", onParentSigint);
      process.once("SIGTERM", onParentSigterm);
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.ipc.call.ping();
      return true;
    } catch {
      return false;
    }
  }

  async pages(): Promise<DaemonResultMap["pages"]> {
    return this.ipc.call.pages();
  }

  async exec(args: DaemonExecArgs): Promise<DaemonExecResult> {
    return this.ipc.call.exec(args);
  }

  async readonlyExec(args: DaemonReadonlyExecArgs): Promise<DaemonExecResult> {
    return this.ipc.call.readonlyExec(args);
  }

  async snapshot(
    args: DaemonSnapshotArgs = {},
  ): Promise<DaemonResultMap["snapshot"]> {
    return this.ipc.call.snapshot(args);
  }

  async getWorkflowStatus(): Promise<WorkflowStatus> {
    return this.ipc.call.getWorkflowStatus();
  }

  async resumeWorkflow(): Promise<void> {
    await this.ipc.call.resumeWorkflow();
  }

  async close(): Promise<DaemonCloseResult> {
    return this.ipc.call.close();
  }

  destroy(): void {
    this.ipc.destroy();
  }
}
