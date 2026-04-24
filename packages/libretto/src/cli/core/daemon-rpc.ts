/**
 * Typed RPC layer for daemon ↔ CLI communication over a Unix domain socket.
 *
 * `connectDaemon(socketPath)` — returns a client with typed methods.
 * `serveDaemon(socketPath, handlers)` — starts a server that dispatches to handlers.
 *
 * Adding a new RPC method:
 *   1. Add its request/response types below.
 *   2. Add the method name to `DaemonHandlers` and `DaemonAPI`.
 *   3. Both sides get compile-time type checking automatically.
 */

import http from "node:http";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { existsSync, unlinkSync } from "node:fs";

// ── RPC types ──────────────────────────────────────────────────────────

export type ExecRequest = {
  code: string;
  mode: "exec" | "readonly-exec";
  pageId?: string;
  visualize?: boolean;
};

export type ExecResult = {
  /** Formatted display string, or `null` when the expression produced no value. */
  output: string | null;
  strippedCatchCount: number;
};

// ── Client ─────────────────────────────────────────────────────────────

export type DaemonAPI = {
  /** Execute code in the daemon's persistent REPL. */
  exec(request: ExecRequest): Promise<ExecResult>;
};

/**
 * Connect to a running daemon. Returns typed methods that throw on
 * transport or daemon-reported errors.
 */
export function connectDaemon(socketPath: string): DaemonAPI {
  return {
    async exec(request: ExecRequest): Promise<ExecResult> {
      const body = await postJson(socketPath, "/exec", request);
      if (!body.ok) {
        throw new Error(body.error?.message ?? "Unknown daemon exec error");
      }
      return body.result as ExecResult;
    },
  };
}

// ── Server ─────────────────────────────────────────────────────────────

export type DaemonHandlers = {
  exec(request: ExecRequest): Promise<ExecResult>;
};

/**
 * Start an HTTP server on a Unix socket that dispatches typed RPC calls.
 *
 * Handles body parsing, JSON serialization, 404s, and uncaught handler
 * errors so handlers only deal with typed payloads and return values.
 */
export function serveDaemon(
  socketPath: string,
  handlers: DaemonHandlers,
): Server {
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  const dispatch: Record<string, (body: unknown) => Promise<unknown>> = {
    "/exec": (body) => handlers.exec(body as ExecRequest),
  };

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const handler =
        req.method === "POST" && req.url ? dispatch[req.url] : undefined;
      if (!handler) {
        respond(res, 404, { ok: false, error: { message: "Not found" } });
        return;
      }

      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        respond(res, 400, {
          ok: false,
          error: { message: "Invalid JSON body" },
        });
        return;
      }

      try {
        const result = await handler(body);
        respond(res, 200, { ok: true, result });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        respond(res, 200, {
          ok: false,
          error: { message: error.message, stack: error.stack },
        });
      }
    },
  );

  server.listen(socketPath);
  return server;
}

// ── Internal helpers ───────────────────────────────────────────────────

type WireResponse = {
  ok: boolean;
  result?: unknown;
  error?: { message: string; stack?: string };
};

function postJson(
  socketPath: string,
  path: string,
  payload: unknown,
): Promise<WireResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        socketPath,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(
              JSON.parse(
                Buffer.concat(chunks).toString("utf-8"),
              ) as WireResponse,
            );
          } catch (err) {
            reject(new Error(`Invalid JSON from daemon: ${err}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function respond(
  res: ServerResponse,
  status: number,
  body: WireResponse,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
