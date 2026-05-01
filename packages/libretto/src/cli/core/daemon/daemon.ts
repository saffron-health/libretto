/**
 * Browser daemon process.
 *
 * Launched as a detached child process by `runOpen()` or `runConnect()` in
 * `browser.ts`. Receives configuration as a JSON string in `process.argv[2]`.
 *
 * Two modes:
 * - **Launch** (`libretto open`): launches Chromium, owns the browser
 *   lifecycle, and closes it on shutdown.
 * - **Connect** (`libretto connect`): connects to an existing CDP endpoint,
 *   discovers pages, and disconnects (without closing the browser) on
 *   shutdown. The browser is externally managed.
 *
 * In both modes the daemon:
 * - Installs session telemetry (network/action logging)
 * - Serves IPC commands (exec, readonly-exec, pages, snapshot) over a
 *   Unix domain socket
 * - Stays alive until the browser disconnects or a signal is received
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { mkdir } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { installSessionTelemetry } from "../session-telemetry.js";
import {
  createLoggerForSession,
  getSessionDir,
  getSessionNetworkLogPath,
  getSessionActionsLogPath,
} from "../context.js";
import type { LoggerApi } from "../../../shared/logger/index.js";
import {
  DaemonServer,
  getDaemonSocketPath,
  type DaemonRequest,
} from "./ipc.js";
import { wrapPageForActionLogging } from "../telemetry.js";
import { handlePages } from "./pages.js";
import { handleExec, handleReadonlyExec } from "./exec.js";
import { handleSnapshot } from "./snapshot.js";
import { librettoCommand } from "../package-manager.js";
import {
  isConnectConfig,
  type DaemonConfig,
  type DaemonLaunchConfig,
  type DaemonConnectConfig,
} from "./config.js";

function isOperationalPage(page: Page): boolean {
  const url = page.url();
  return !url.startsWith("devtools://") && !url.startsWith("chrome-error://");
}

type TelemetryEntry = Record<string, unknown>;

// ── BrowserDaemon ──────────────────────────────────────────────────────

const PROTOCOL_VERSION = 1;
const REQUEST_TIMEOUT_MS = 60_000;

class BrowserDaemon {
  readonly logger: LoggerApi;
  private readonly execState: Record<string, unknown> = {};
  private readonly pageById = new Map<string, Page>();

  private constructor(
    private readonly session: string,
    private readonly externallyManaged: boolean,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly ipcServer: DaemonServer,
    logger: LoggerApi,
  ) {
    this.logger = logger.withScope("child");
  }

  private shuttingDown = false;

  private trackPage(page: Page): string {
    const id = `page-${Math.random().toString(36).slice(2, 5)}`;
    this.pageById.set(id, page);
    page.on("close", () => this.pageById.delete(id));
    return id;
  }

  // ── Shared initialization ──────────────────────────────────────────

  /**
   * Common setup after the mode-specific code has obtained a browser,
   * context, and page(s). Installs telemetry, action logging, IPC
   * server, page tracking, and the browser disconnect handler.
   */
  private static async initialize(args: {
    session: string;
    externallyManaged: boolean;
    browser: Browser;
    context: BrowserContext;
    page: Page;
    initialPages: Page[];
    /** If set, navigate to this URL after telemetry but before starting IPC. */
    navigateUrl?: string;
  }): Promise<BrowserDaemon> {
    const {
      session,
      externallyManaged,
      browser,
      context,
      page,
      initialPages,
      navigateUrl,
    } = args;

    await mkdir(getSessionDir(session), { recursive: true });

    // Telemetry — may fail on connect-mode reconnections where
    // exposeFunction bindings already exist; log and continue.
    const networkLogFile = getSessionNetworkLogPath(session);
    const actionsLogFile = getSessionActionsLogPath(session);
    const logger = createLoggerForSession(session);

    try {
      await installSessionTelemetry({
        context,
        initialPage: page,
        includeUserDomActions: true,
        logAction: (entry: TelemetryEntry) => {
          appendFileSync(actionsLogFile, JSON.stringify(entry) + "\n");
        },
        logNetwork: (entry: TelemetryEntry) => {
          appendFileSync(networkLogFile, JSON.stringify(entry) + "\n");
        },
      });
    } catch (err) {
      logger.warn("telemetry-install-failed", {
        session,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // IPC server — handler is wired after construction to avoid a
    // circular type inference issue (daemon references itself).
    const socketPath = getDaemonSocketPath(session);
    let handler: (request: DaemonRequest) => Promise<unknown>;
    const ipcServer = new DaemonServer(socketPath, (request) =>
      handler(request),
    );
    const daemon = new BrowserDaemon(
      session,
      externallyManaged,
      browser,
      context,
      page,
      ipcServer,
      logger,
    );

    // Action logging and page tracking must be registered before optional
    // navigation so popups opened during the initial load are visible to IPC.
    for (const p of initialPages) {
      wrapPageForActionLogging(p, session);
      daemon.trackPage(p);
    }
    context.on("page", (newPage) => {
      wrapPageForActionLogging(newPage, session);
      daemon.trackPage(newPage);
    });

    // Navigate after telemetry is installed (so we capture the initial
    // page load) but before starting the IPC server (so callers polling
    // for IPC readiness see a page that has already loaded).
    if (navigateUrl) {
      await page.goto(navigateUrl);
    }

    handler = (request) => daemon.handleRequest(request);
    await ipcServer.listen();
    daemon.logger.info("ipc-server-listening", { socketPath });

    browser.on("disconnected", () => {
      void daemon.shutdown("browser-disconnected-exiting", false);
    });

    return daemon;
  }

  // ── Launch mode ────────────────────────────────────────────────────

  static async launchBrowser(config: DaemonLaunchConfig): Promise<BrowserDaemon> {
    const windowPositionArg = config.windowPosition
      ? `--window-position=${config.windowPosition.x},${config.windowPosition.y}`
      : undefined;

    const browser = await chromium.launch({
      headless: !config.headed,
      args: [
        "--disable-blink-features=AutomationControlled",
        `--remote-debugging-port=${config.port}`,
        "--remote-debugging-address=127.0.0.1",
        "--no-focus-on-check",
        ...(windowPositionArg ? [windowPositionArg] : []),
      ],
    });

    const context = await browser.newContext({
      ...(config.storageStatePath
        ? { storageState: config.storageStatePath }
        : {}),
      viewport: {
        width: config.viewport.width,
        height: config.viewport.height,
      },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);

    const daemon = await BrowserDaemon.initialize({
      session: config.session,
      externallyManaged: false,
      browser,
      context,
      page,
      initialPages: [page],
      navigateUrl: config.url,
    });

    daemon.logger.info("child-launched", {
      port: config.port,
      pid: process.pid,
      session: config.session,
    });

    return daemon;
  }

  // ── Connect mode ───────────────────────────────────────────────────

  static async connectToEndpoint(
    config: DaemonConnectConfig,
  ): Promise<BrowserDaemon> {
    const browser = await chromium.connectOverCDP(config.cdpEndpoint);

    // Discover existing contexts and pages.
    const contexts = browser.contexts();
    const context =
      contexts.length > 0 ? contexts[0] : await browser.newContext();
    const operationalPages = context.pages().filter(isOperationalPage);
    const page =
      operationalPages.length > 0
        ? operationalPages[operationalPages.length - 1]
        : await context.newPage();

    const daemon = await BrowserDaemon.initialize({
      session: config.session,
      externallyManaged: true,
      browser,
      context,
      page,
      initialPages:
        operationalPages.length > 0 ? operationalPages : [page],
      navigateUrl: config.url,
    });

    daemon.logger.info("child-connected", {
      cdpEndpoint: config.cdpEndpoint,
      url: config.url,
      pid: process.pid,
      session: config.session,
    });

    return daemon;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async shutdown(reason: string, closeBrowser: boolean): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.info(reason, { session: this.session });
    await this.ipcServer.close();
    if (!closeBrowser) return;
    if (this.externallyManaged) {
      // Drop the CDP pipe without killing the external browser.
      try {
        (
          this.browser as unknown as {
            _connection?: { close(): void };
          }
        )._connection?.close();
      } catch {
        // Connection may already be closed.
      }
    } else {
      await this.browser.close();
    }
  }

  // ── Page resolution ────────────────────────────────────────────────

  private resolveTargetPage(pageId?: string): Page {
    if (!pageId) {
      if (this.pageById.size > 1) {
        throw new Error(
          `Multiple pages are open in session "${this.session}". Pass --page <id> to target a page (run "${librettoCommand(`pages --session ${this.session}`)}" to list ids).`,
        );
      }
      // Return the single tracked page rather than `this.page` — the
      // initial page may have been closed and replaced by a new one.
      if (this.pageById.size === 1) {
        return this.pageById.values().next().value!;
      }
      return this.page;
    }
    const page = this.pageById.get(pageId);
    if (!page) {
      throw new Error(
        `Page "${pageId}" was not found in session "${this.session}". Run "${librettoCommand(`pages --session ${this.session}`)}" to list ids.`,
      );
    }
    return page;
  }

  // ── IPC handler ────────────────────────────────────────────────────

  private async handleRequest(request: DaemonRequest): Promise<unknown> {
    if (request.command === "ping") {
      return { protocolVersion: PROTOCOL_VERSION };
    }

    // All non-ping commands get a timeout guard. The timer is cleared
    // when the command settles to avoid orphaned timers that would
    // keep the event loop alive after shutdown.
    let timerId: ReturnType<typeof setTimeout>;
    return Promise.race([
      this.dispatchCommand(request).finally(() => clearTimeout(timerId)),
      new Promise<never>((_resolve, reject) => {
        timerId = setTimeout(
          () =>
            reject(
              new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`),
            ),
          REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  }

  private async dispatchCommand(request: DaemonRequest): Promise<unknown> {
    switch (request.command) {
      case "pages":
        return handlePages(this.pageById, this.page);
      case "exec":
        return handleExec(
          this.resolveTargetPage(request.pageId),
          request.code,
          this.context,
          this.browser,
          this.execState,
          this.session,
          request.visualize,
        );
      case "readonly-exec":
        return handleReadonlyExec(
          this.resolveTargetPage(request.pageId),
          request.code,
        );
      case "snapshot":
        return handleSnapshot(
          this.resolveTargetPage(request.pageId),
          this.session,
          this.logger,
          request.pageId,
        );
      default:
        throw new Error(
          `Unknown command: ${(request as { command: string }).command}`,
        );
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = JSON.parse(process.argv[2]) as DaemonConfig;

  const daemon = isConnectConfig(config)
    ? await BrowserDaemon.connectToEndpoint(config)
    : await BrowserDaemon.launchBrowser(config);

  process.on("SIGTERM", () => {
    void daemon.shutdown("child-sigterm", true);
  });

  process.on("SIGINT", () => {
    void daemon.shutdown("child-sigint", true);
  });

  process.on("uncaughtException", (err) => {
    daemon.logger.error("uncaught-exception", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    daemon.logger.warn("unhandled-rejection", { reason: String(reason) });
  });

  process.on("exit", (code) => {
    daemon.logger.info("child-exit", {
      code,
      pid: process.pid,
      session: config.session,
    });
  });

  // The process stays alive as long as the IPC server and browser
  // connection hold the event loop open. shutdown() closes both,
  // letting the process exit naturally.
}

await main();
