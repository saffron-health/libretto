import { createHash } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, connect as netConnect, type Server } from "node:net";
import { unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { LoggerApi } from "../../../shared/logger/index.js";
import { REPO_ROOT } from "../context.js";
import type { DaemonConfig } from "./config.js";

export type DaemonExecOutput = { stdout: string; stderr: string };

type ErrorWithOutput = Error & { output?: DaemonExecOutput };

// ---------------------------------------------------------------------------
// Request types — one shape per daemon command
// ---------------------------------------------------------------------------

export type DaemonRequest =
  | { id: string; command: "ping" }
  | { id: string; command: "pages" }
  | { id: string; command: "snapshot"; pageId?: string }
  | {
      id: string;
      command: "exec";
      code: string;
      pageId?: string;
      visualize?: boolean;
    }
  | { id: string; command: "readonly-exec"; code: string; pageId?: string };

// ---------------------------------------------------------------------------
// Response types — success or error, keyed by the originating request id
// ---------------------------------------------------------------------------

export type DaemonResponse =
  | { id: string; type: "result"; data: unknown }
  | {
      id: string;
      type: "error";
      message: string;
      output?: DaemonExecOutput;
    };

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
};

function isDaemonReadyMessage(message: unknown): message is DaemonReadyMessage {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as { type?: unknown; socketPath?: unknown };
  return candidate.type === "ready" && typeof candidate.socketPath === "string";
}

export type DaemonCommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; output?: DaemonExecOutput };

export type DaemonClientSpawnOptions = {
  config: DaemonConfig;
  logger: LoggerApi;
  logPath: string;
  startupTimeoutMs: number;
  onFailure?: () => Promise<unknown>;
};

export type DaemonClientSpawnResult = {
  pid: number;
  socketPath: string;
  client: DaemonClient;
};

// ---------------------------------------------------------------------------
// Socket path resolution
// ---------------------------------------------------------------------------

/**
 * Deterministic Unix domain socket path for a given session.
 *
 * The path lives in `/tmp` to stay well under the macOS 104-byte Unix socket
 * path limit. The hash combines `REPO_ROOT` and the session name so different
 * repos (or sessions within the same repo) never collide.
 */
export function getDaemonSocketPath(session: string): string {
  const hash = createHash("sha256")
    .update(`${REPO_ROOT}:${session}`)
    .digest("hex")
    .slice(0, 12);
  return `/tmp/libretto-${process.getuid!()}-${hash}.sock`;
}

// ---------------------------------------------------------------------------
// DaemonServer — Unix domain socket server, NDJSON, one request per connection
// ---------------------------------------------------------------------------

export type RequestHandler = (request: DaemonRequest) => Promise<unknown>;

export class DaemonServer {
  private server: Server | null = null;

  constructor(
    private readonly socketPath: string,
    private readonly handler: RequestHandler,
  ) {}

  async listen(): Promise<void> {
    // Remove stale socket file if present.
    try {
      await unlink(this.socketPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    const server = createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) return;

        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        void (async () => {
          let response: DaemonResponse;
          try {
            const request = JSON.parse(line) as DaemonRequest;
            const data = await this.handler(request);
            response = { id: request.id, type: "result", data };
          } catch (err) {
            const id = (() => {
              try {
                return (JSON.parse(line) as { id?: string }).id ?? "unknown";
              } catch {
                return "unknown";
              }
            })();
            response = {
              id,
              type: "error",
              message: err instanceof Error ? err.message : String(err),
              output:
                err instanceof Error
                  ? (err as ErrorWithOutput).output
                  : undefined,
            };
          }
          socket.end(JSON.stringify(response) + "\n");
        })();
      });
    });

    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(this.socketPath, () => resolve());
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

    try {
      await unlink(this.socketPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Response data types — maps command name to the shape returned on success
// ---------------------------------------------------------------------------

export type DaemonResultMap = {
  ping: { protocolVersion: number };
  pages: Array<{ id: string; url: string; active: boolean }>;
  exec: { result: unknown; output?: DaemonExecOutput };
  "readonly-exec": {
    result: unknown;
    output?: DaemonExecOutput;
  };
  snapshot: {
    pngPath: string;
    htmlPath: string;
    snapshotRunId: string;
    pageUrl: string;
    title: string;
  };
};

// ---------------------------------------------------------------------------
// DaemonClient — connects to UDS, sends NDJSON request, reads response
// ---------------------------------------------------------------------------

export class DaemonClient {
  constructor(private readonly socketPath: string) {}

  static async spawn(
    options: DaemonClientSpawnOptions,
  ): Promise<DaemonClientSpawnResult> {
    const { config, logger, logPath, startupTimeoutMs, onFailure } =
      options;
    const { session } = config;

    const daemonEntryPath = fileURLToPath(
      new URL("./daemon.js", import.meta.url),
    );
    const require = createRequire(import.meta.url);
    const tsxImportPath = pathToFileURL(require.resolve("tsx/esm")).href;

    const childStderrFd = openSync(logPath, "a");
    const child = spawn(
      process.execPath,
      ["--import", tsxImportPath, daemonEntryPath, JSON.stringify(config)],
      {
        detached: true,
        stdio: ["ignore", "ignore", childStderrFd, "ipc"],
      },
    );
    closeSync(childStderrFd);

    const pid = child.pid!;
    logger.info("daemon-spawned", { pid, session });

    const socketPath = await DaemonClient.waitForReadyMessage({
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
    }).catch(async (error: unknown) => {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may have already exited.
      }
      await onFailure?.();
      throw error;
    });

    const client = new DaemonClient(socketPath);
    logger.info("daemon-ipc-ready", { session, socketPath });
    return { pid, socketPath, client };
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
  }): Promise<string> {
    const {
      child,
      timeoutMs,
      formatTimeoutError,
      formatSpawnError,
      formatExitError,
      onReady,
      onSpawnError,
      onExit,
    } = args;

    return new Promise<string>((resolve, reject) => {
      let ready = false;
      let timeout: ReturnType<typeof setTimeout>;

      const cleanup = (): void => {
        clearTimeout(timeout);
        child.off("message", onMessage);
        child.off("error", onError);
        child.off("exit", onChildExit);
      };

      const fail = (error: Error): void => {
        cleanup();
        reject(error);
      };

      timeout = setTimeout(() => fail(formatTimeoutError()), timeoutMs);

      const onMessage = (message: unknown): void => {
        if (!isDaemonReadyMessage(message)) return;
        ready = true;
        cleanup();
        onReady?.(message);
        resolve(message.socketPath);
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

      child.on("message", onMessage);
      child.on("error", onError);
      child.on("exit", onChildExit);
    });
  }

  private async send(request: DaemonRequest): Promise<DaemonResponse> {
    return new Promise<DaemonResponse>((resolve, reject) => {
      const socket = netConnect(this.socketPath);
      let buffer = "";

      socket.on("connect", () => {
        socket.write(JSON.stringify(request) + "\n");
      });

      socket.on("data", (chunk) => {
        buffer += chunk.toString();
      });

      socket.on("end", () => {
        try {
          const response = JSON.parse(buffer.trim()) as DaemonResponse;
          resolve(response);
        } catch (err) {
          reject(
            new Error(
              `Failed to parse daemon response: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        }
      });

      socket.on("error", (err) => {
        reject(err);
      });
    });
  }

  private generateId(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  private async sendOrThrow<C extends DaemonRequest["command"]>(
    request: DaemonRequest & { command: C },
  ): Promise<DaemonResultMap[C]> {
    const response = await this.send(request);
    if (response.type === "error") {
      throw new DaemonClientError(response.message, response.output);
    }
    return response.data as DaemonResultMap[C];
  }

  private async sendResult<C extends DaemonRequest["command"]>(
    request: DaemonRequest & { command: C },
  ): Promise<DaemonCommandResult<DaemonResultMap[C]>> {
    const response = await this.send(request);
    if (response.type === "error") {
      return {
        ok: false,
        message: response.message,
        output: response.output,
      };
    }
    return { ok: true, data: response.data as DaemonResultMap[C] };
  }

  async ping(): Promise<boolean> {
    try {
      await this.sendOrThrow({ id: this.generateId(), command: "ping" });
      return true;
    } catch {
      return false;
    }
  }

  async pages(): Promise<DaemonResultMap["pages"]> {
    return this.sendOrThrow({ id: this.generateId(), command: "pages" });
  }

  async exec(args: {
    code: string;
    pageId?: string;
    visualize?: boolean;
  }): Promise<DaemonCommandResult<DaemonResultMap["exec"]>> {
    return this.sendResult({
      id: this.generateId(),
      command: "exec",
      ...args,
    });
  }

  async readonlyExec(args: {
    code: string;
    pageId?: string;
  }): Promise<DaemonCommandResult<DaemonResultMap["readonly-exec"]>> {
    return this.sendResult({
      id: this.generateId(),
      command: "readonly-exec",
      ...args,
    });
  }

  async snapshot(
    args: {
      pageId?: string;
    } = {},
  ): Promise<DaemonResultMap["snapshot"]> {
    return this.sendOrThrow({
      id: this.generateId(),
      command: "snapshot",
      ...args,
    });
  }
}
