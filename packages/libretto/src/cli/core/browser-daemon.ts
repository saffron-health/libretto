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
import type { CDPSession, Page } from "playwright";
import { mkdir, unlink } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import vm from "node:vm";
import { Session as InspectorSession } from "node:inspector/promises";
import type { Server } from "node:http";
import { installInstrumentation } from "../../shared/instrumentation/index.js";
import { installSessionTelemetry } from "./session-telemetry.js";
import {
  stripEmptyCatchHandlers,
  stripTypeScript,
} from "./exec-sandbox.js";
import { createReadonlyExecHelpers } from "./readonly-exec.js";
import { serveDaemon, type ExecRequest, type ExecResult } from "./daemon-rpc.js";
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

// ── Exec sandbox (Inspector-based persistent context) ──────────────────
//
// Uses the Chrome DevTools Protocol `Runtime.evaluate` with `replMode: true`
// against a dedicated `vm.Context`. This gives us REPL semantics —
// `const`/`let`/`class` persistence, top-level `await`, `const`
// re-declaration, and proper error reporting — all via a public Node API,
// without the `repl` module's internal domain hacks.

type EvalResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/**
 * A persistent execution sandbox backed by `node:inspector/promises`.
 *
 * Each sandbox owns a `vm.Context` and an Inspector session. Code is
 * evaluated via `Runtime.evaluate({ replMode: true })`, which gives V8
 * REPL semantics: declarations persist, `const` can be re-declared, and
 * top-level `await` works natively.
 */
/**
 * Typed wrapper for `Inspector.Session.post` calls.
 *
 * The `node:inspector/promises` type declarations are incomplete in
 * `@types/node` — the Session class is missing `post()` overloads, and
 * `Runtime.EvaluateParameterType` doesn't include `replMode`. We cast
 * through this helper to keep the rest of the code clean.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InspectorPost = (method: string, params?: Record<string, unknown>) => Promise<any>;

type RuntimeEvaluateResult = {
  result: { type: string; value?: unknown; description?: string };
  exceptionDetails?: { text: string; exception?: { description?: string } };
};

class InspectorSandbox {
  #session: InspectorSession;
  #post: InspectorPost;
  #contextId!: number;
  #context: vm.Context;
  #name: string;
  /** Serializes evaluations so two concurrent calls can't interleave. */
  #queue = Promise.resolve<EvalResult>({ ok: true, value: undefined });

  constructor(globals: Record<string, unknown>, name: string) {
    this.#name = name;
    this.#context = vm.createContext(globals, { name });
    this.#session = new InspectorSession();
    // Cast once — see `InspectorPost` comment above.
    this.#post = this.#session.post.bind(this.#session) as InspectorPost;
  }

  async init(): Promise<void> {
    this.#session.connect();

    // Listen for context creation events before enabling Runtime so that
    // `Runtime.enable` replays the already-created context.
    const contextReady = new Promise<number>((resolve) => {
      this.#session.on(
        "Runtime.executionContextCreated",
        ({ params }: { params: { context: { name: string; id: number } } }) => {
          if (params.context.name === this.#name) {
            resolve(params.context.id);
          }
        },
      );
    });

    await this.#post("Runtime.enable");
    this.#contextId = await contextReady;
  }

  /** Read a global binding from the sandbox context. */
  getGlobal(key: string): unknown {
    return (this.#context as Record<string, unknown>)[key];
  }

  /** Update or add a global binding in the sandbox context. */
  setGlobal(key: string, value: unknown): void {
    (this.#context as Record<string, unknown>)[key] = value;
  }

  /** Evaluate `code` with REPL semantics. Serialized to one-at-a-time. */
  eval(code: string): Promise<EvalResult> {
    const run = async (): Promise<EvalResult> => {
      const result: RuntimeEvaluateResult = await this.#post(
        "Runtime.evaluate",
        {
          contextId: this.#contextId,
          expression: code,
          replMode: true,
          awaitPromise: true,
          returnByValue: true,
        },
      );

      if (result.exceptionDetails) {
        const desc =
          result.result.description ??
          result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text;
        return { ok: false, error: desc ?? "Unknown error" };
      }

      return { ok: true, value: result.result.value };
    };

    // Chain onto the queue so evaluations never overlap.
    const next = this.#queue.then(run, run);
    this.#queue = next.then(
      () => ({ ok: true as const, value: undefined }),
      () => ({ ok: true as const, value: undefined }),
    );
    return next;
  }

  disconnect(): void {
    this.#session.disconnect();
  }
}

// Lazy sandbox creation — cache the promise so concurrent requests
// don't race on init.
let _execSandboxPromise: Promise<InspectorSandbox> | undefined;
let _readonlyExecSandboxPromise: Promise<InspectorSandbox> | undefined;

function getExecSandbox(): Promise<InspectorSandbox> {
  if (!_execSandboxPromise) {
    _execSandboxPromise = (async () => {
      const sb = new InspectorSandbox(
        {
          page,
          context,
          browser,
          state: {} as Record<string, unknown>,
          console,
          setTimeout,
          setInterval,
          clearTimeout,
          clearInterval,
          fetch,
          URL,
          Buffer,
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
        },
        "libretto-exec",
      );
      await sb.init();
      return sb;
    })();
  }
  return _execSandboxPromise;
}

function getReadonlyExecSandbox(): Promise<InspectorSandbox> {
  if (!_readonlyExecSandboxPromise) {
    _readonlyExecSandboxPromise = (async () => {
      const sb = new InspectorSandbox(
        createReadonlyExecHelpers(page) as unknown as Record<string, unknown>,
        "libretto-readonly-exec",
      );
      await sb.init();
      return sb;
    })();
  }
  return _readonlyExecSandboxPromise;
}

// ── Page resolution ────────────────────────────────────────────────────

/** Resolve a Playwright page's CDP target ID (same logic as browser.ts). */
async function resolvePageId(p: Page): Promise<string> {
  const cdp: CDPSession = await p.context().newCDPSession(p);
  try {
    const info = await cdp.send("Target.getTargetInfo");
    const targetId = (info as { targetInfo?: { targetId?: unknown } })
      ?.targetInfo?.targetId;
    if (typeof targetId !== "string" || targetId.length === 0) {
      throw new Error(
        `Could not resolve target id for page at URL "${p.url()}".`,
      );
    }
    return targetId;
  } finally {
    await cdp.detach();
  }
}

/** Find a page by its CDP target ID. */
async function findPageById(pageId: string): Promise<Page | undefined> {
  for (const p of context.pages()) {
    const id = await resolvePageId(p);
    if (id === pageId) return p;
  }
  return undefined;
}

// Track pages that have already been wrapped for action logging so we
// don't double-wrap on repeated targeted execs.
const wrappedPages = new WeakSet<Page>();

function ensureActionLogging(p: Page, pageId?: string): void {
  if (wrappedPages.has(p)) return;
  wrapPageForActionLogging(p, config.session, pageId);
  wrappedPages.add(p);
}

let execServer: Server | undefined;

if (config.execSocketPath) {
  async function handleExec(req: ExecRequest): Promise<ExecResult> {
    const { code: rawCode, mode, pageId, visualize } = req;

    childLog("info", "exec-start", {
      mode,
      codeLength: rawCode.length,
      codePreview: rawCode.slice(0, 200),
      pageId,
    });

    const sandbox =
      mode === "readonly-exec"
        ? await getReadonlyExecSandbox()
        : await getExecSandbox();

    // Resolve the effective page for this request. If pageId is given,
    // temporarily rebind and restore after eval so we don't mutate the
    // default for future untargeted execs.
    let restorePage: (() => void) | undefined;
    if (pageId) {
      const targetPage = await findPageById(pageId);
      if (!targetPage) {
        throw new Error(
          `Page "${pageId}" was not found in session "${config.session}". Run "libretto pages --session ${config.session}" to list ids.`,
        );
      }
      if (mode === "readonly-exec") {
        const readonlyHelpers = createReadonlyExecHelpers(targetPage);
        const prev = sandbox.getGlobal("page");
        sandbox.setGlobal("page", readonlyHelpers.page);
        restorePage = () => sandbox.setGlobal("page", prev);
      } else {
        ensureActionLogging(targetPage, pageId);
        const prev = sandbox.getGlobal("page");
        sandbox.setGlobal("page", targetPage);
        restorePage = () => sandbox.setGlobal("page", prev);
      }
    }

    // Ensure action logging for the default page on first exec.
    if (mode === "exec") {
      ensureActionLogging(page);
    }

    // Install visualization if requested.
    if (visualize && mode === "exec") {
      const effectivePage = (sandbox.getGlobal("page") ?? page) as Page;
      await installInstrumentation(effectivePage, { visualize: true });
    }

    const { cleaned, strippedCount } = stripEmptyCatchHandlers(rawCode);
    const preparedCode = stripTypeScript(cleaned);

    try {
      const result = await sandbox.eval(preparedCode);

      if (!result.ok) {
        childLog("error", "exec-error", {
          mode,
          message: result.error,
          codePreview: rawCode.slice(0, 200),
        });
        throw new Error(result.error);
      }

      const output =
        result.value === undefined || result.value === null
          ? null
          : typeof result.value === "string"
            ? result.value
            : JSON.stringify(result.value, null, 2);

      childLog("info", "exec-success", {
        mode,
        hasResult: output !== null,
      });
      return { output, strippedCatchCount: strippedCount };
    } finally {
      restorePage?.();
    }
  }

  execServer = serveDaemon(config.execSocketPath, {
    exec: handleExec,
  });

  execServer.on("listening", () => {
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
