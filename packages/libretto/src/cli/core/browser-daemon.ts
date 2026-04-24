/**
 * Browser daemon process.
 *
 * Launched as a detached child process by `runOpen()` in `browser.ts`.
 * Receives configuration as a JSON string in `process.argv[2]`.
 *
 * Responsibilities:
 * - Launch Chromium with the specified settings
 * - Create a browser context and page
 * - Install session telemetry (network/action logging)
 * - Navigate to the requested URL
 * - Stay alive until the browser disconnects or a signal is received
 */

import { chromium } from "playwright";
import type { Page } from "playwright";
import { mkdir, unlink } from "node:fs/promises";
import { appendFileSync, existsSync, unlinkSync } from "node:fs";
import repl from "node:repl";
import { createServer, type Server } from "node:http";
import { PassThrough } from "node:stream";
import { installSessionTelemetry } from "./session-telemetry.js";
import { stripEmptyCatchHandlers, stripTypeScript } from "./exec-sandbox.js";
import { createReadonlyExecHelpers } from "./readonly-exec.js";
import {
  readNetworkLog,
  readActionLog,
  wrapPageForActionLogging,
} from "./telemetry.js";
import {
  getSessionDir,
  getSessionLogsPath,
  getSessionNetworkLogPath,
  getSessionActionsLogPath,
  getSessionStatePath,
} from "./context.js";

// ── Config schema ──────────────────────────────────────────────────────

type DaemonConfig = {
  port: number;
  url: string;
  session: string;
  headed: boolean;
  viewport: { width: number; height: number };
  storageStatePath?: string;
  windowPosition?: { x: number; y: number };
  execSocketPath?: string;
};

const config: DaemonConfig = JSON.parse(process.argv[2]);

// ── Derived paths ──────────────────────────────────────────────────────

const sessionDir = getSessionDir(config.session);
await mkdir(sessionDir, { recursive: true });

const logFile = getSessionLogsPath(config.session);
const networkLogFile = getSessionNetworkLogPath(config.session);
const actionsLogFile = getSessionActionsLogPath(config.session);

type TelemetryEntry = Record<string, unknown>;

function childLog(
  level: string,
  event: string,
  data: Record<string, unknown> = {},
): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    id: Math.random().toString(36).slice(2, 10),
    level,
    scope: "libretto.child",
    event,
    data,
  });
  appendFileSync(logFile, entry + "\n");
}

function logAction(entry: TelemetryEntry): void {
  appendFileSync(actionsLogFile, JSON.stringify(entry) + "\n");
}

function logNetwork(entry: TelemetryEntry): void {
  appendFileSync(networkLogFile, JSON.stringify(entry) + "\n");
}

// ── Launch browser ─────────────────────────────────────────────────────

const windowPositionArg = config.windowPosition
  ? `--window-position=${config.windowPosition.x},${config.windowPosition.y}`
  : undefined;

const launchArgs = [
  "--disable-blink-features=AutomationControlled",
  `--remote-debugging-port=${config.port}`,
  "--remote-debugging-address=127.0.0.1",
  "--no-focus-on-check",
  ...(windowPositionArg ? [windowPositionArg] : []),
];

const browser = await chromium.launch({
  headless: !config.headed,
  args: launchArgs,
});

async function cleanupSessionState(): Promise<void> {
  const sessionStatePath = getSessionStatePath(config.session);
  try {
    await unlink(sessionStatePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

let shuttingDown = false;
let wakeDaemon: () => void;
const sleepPromise = new Promise<void>((resolve) => {
  wakeDaemon = resolve;
});

async function shutdown(
  reason: string,
  closeBrowser: boolean,
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    childLog("info", reason, { port: config.port });
    // Close exec server and clean up socket
    if (execServer) {
      execServer.close();
    }
    if (config.execSocketPath) {
      try {
        await unlink(config.execSocketPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          childLog("warn", "exec-socket-cleanup-error", {
            error: String(err),
          });
        }
      }
    }
    await cleanupSessionState();
    if (closeBrowser) await browser.close();
  } finally {
    wakeDaemon();
  }
}

browser.on("disconnected", () => {
  void shutdown("browser-disconnected-exiting", false);
});

// ── Create context & page ──────────────────────────────────────────────

const context = await browser.newContext({
  ...(config.storageStatePath ? { storageState: config.storageStatePath } : {}),
  viewport: {
    width: config.viewport.width,
    height: config.viewport.height,
  },
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
});

const page = await context.newPage();

// ── Page defaults & telemetry ──────────────────────────────────────────

page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(45000);

await installSessionTelemetry({
  context,
  initialPage: page,
  includeUserDomActions: true,
  logAction,
  logNetwork,
});

// ── Navigate ───────────────────────────────────────────────────────────

await page.goto(config.url);

// ── Exec server (persistent REPL) ─────────────────────────────────────

/**
 * Create a REPL instance with an isolated context.
 *
 * `useGlobal: false` gives each REPL its own V8 context so exec and
 * readonly-exec don't share state. Node globals like `console`,
 * `setTimeout`, `fetch` aren't available in an isolated context by
 * default, so we copy them from `globalThis`.
 */
function createExecRepl(globals: Record<string, unknown>): repl.REPLServer {
  const r = repl.start({
    input: new PassThrough(),
    output: new PassThrough(),
    prompt: "",
    terminal: false,
    useGlobal: false,
  });
  Object.assign(r.context, globalThis, globals);
  return r;
}

/**
 * Evaluate code in a REPL and return the result as a promise.
 */
async function evalInRepl(
  r: repl.REPLServer,
  code: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    r.eval(code + "\n", r.context, "libretto-exec", (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// Lazy REPL creation — only instantiate when first used.
let _execRepl: repl.REPLServer | undefined;
let _readonlyExecRepl: repl.REPLServer | undefined;

function getExecRepl(): repl.REPLServer {
  if (!_execRepl) {
    _execRepl = createExecRepl({
      page,
      context,
      browser,
      state: {} as Record<string, unknown>,
      networkLog: (
        opts: {
          last?: number;
          filter?: string;
          method?: string;
          pageId?: string;
        } = {},
      ) => readNetworkLog(config.session, opts),
      actionLog: (
        opts: {
          last?: number;
          filter?: string;
          action?: string;
          source?: string;
          pageId?: string;
        } = {},
      ) => readActionLog(config.session, opts),
    });
  }
  return _execRepl;
}

function getReadonlyExecRepl(): repl.REPLServer {
  if (!_readonlyExecRepl) {
    _readonlyExecRepl = createExecRepl(
      createReadonlyExecHelpers(page) as unknown as Record<string, unknown>,
    );
  }
  return _readonlyExecRepl;
}

function stripLeadingReturn(code: string): string {
  return code.replace(/^\s*return\s+/, "");
}

function prepareCode(rawCode: string): string {
  let code = stripTypeScript(rawCode);
  code = stripEmptyCatchHandlers(code).cleaned;
  code = stripLeadingReturn(code);
  return code;
}

function findPageById(pageId: string): Page | undefined {
  return context.pages().find((p) => {
    const url = p.url();
    return url === pageId || url.includes(pageId);
  });
}

let execServer: Server | undefined;

if (config.execSocketPath) {
  // Remove stale socket file if present
  if (existsSync(config.execSocketPath)) {
    unlinkSync(config.execSocketPath);
  }

  execServer = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/exec") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { message: "Not found" } }));
      return;
    }

    // Read request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const bodyStr = Buffer.concat(chunks).toString("utf-8");

    let body: {
      code: string;
      mode: "exec" | "readonly-exec";
      pageId?: string;
      visualize?: boolean;
    };
    try {
      body = JSON.parse(bodyStr) as typeof body;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ ok: false, error: { message: "Invalid JSON body" } }),
      );
      return;
    }

    const { code: rawCode, mode, pageId } = body;

    childLog("info", "exec-start", {
      mode,
      codeLength: rawCode.length,
      codePreview: rawCode.slice(0, 200),
      pageId,
    });

    // Page targeting: update the REPL context's page reference
    const replInstance =
      mode === "readonly-exec" ? getReadonlyExecRepl() : getExecRepl();
    if (pageId) {
      const targetPage = findPageById(pageId);
      if (targetPage) {
        if (mode === "readonly-exec") {
          const readonlyHelpers = createReadonlyExecHelpers(targetPage);
          Object.assign(replInstance.context, {
            page: readonlyHelpers.page,
          });
        } else {
          replInstance.context.page = targetPage;
          wrapPageForActionLogging(targetPage, config.session, pageId);
        }
      }
    }

    const preparedCode = prepareCode(rawCode);

    // Stall detection
    const STALL_THRESHOLD_MS = 60_000;
    const stallTimer = setTimeout(() => {
      childLog("warn", "exec-stall-warning", {
        mode,
        silenceMs: STALL_THRESHOLD_MS,
        codePreview: rawCode.slice(0, 200),
      });
    }, STALL_THRESHOLD_MS);

    try {
      const result = await evalInRepl(replInstance, preparedCode);

      clearTimeout(stallTimer);
      childLog("info", "exec-success", {
        mode,
        hasResult: result !== undefined,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result }));
    } catch (err) {
      clearTimeout(stallTimer);
      const error = err instanceof Error ? err : new Error(String(err));

      childLog("error", "exec-error", {
        mode,
        message: error.message,
        stack: error.stack,
        codePreview: rawCode.slice(0, 200),
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: { message: error.message, stack: error.stack },
        }),
      );
    }
  });

  execServer.listen(config.execSocketPath, () => {
    childLog("info", "exec-server-listening", {
      socketPath: config.execSocketPath,
    });
  });
}

// ── Process lifecycle ──────────────────────────────────────────────────

process.on("SIGTERM", () => {
  void shutdown("child-sigterm", true);
});

process.on("SIGINT", () => {
  void shutdown("child-sigint", true);
});

process.on("uncaughtException", (err) => {
  childLog("error", "uncaught-exception", {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  childLog("warn", "unhandled-rejection", { reason: String(reason) });
});

process.on("exit", (code) => {
  childLog("info", "child-exit", {
    code,
    pid: process.pid,
    port: config.port,
  });
});

childLog("info", "child-launched", {
  port: config.port,
  pid: process.pid,
  session: config.session,
});

// Keep the daemon alive until the browser disconnects or a signal arrives.
await sleepPromise;
process.exit(0);
