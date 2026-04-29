import { createHash } from "node:crypto";
import { createServer, connect as netConnect, type Server } from "node:net";
import { unlink } from "node:fs/promises";
import { REPO_ROOT } from "../context.js";

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
  | { id: string; type: "error"; message: string };

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
  exec: { result: unknown };
  "readonly-exec": { result: unknown };
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
      throw new Error(response.message);
    }
    return response.data as DaemonResultMap[C];
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
  }): Promise<DaemonResultMap["exec"]> {
    return this.sendOrThrow({
      id: this.generateId(),
      command: "exec",
      ...args,
    });
  }

  async readonlyExec(args: {
    code: string;
    pageId?: string;
  }): Promise<DaemonResultMap["readonly-exec"]> {
    return this.sendOrThrow({
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
