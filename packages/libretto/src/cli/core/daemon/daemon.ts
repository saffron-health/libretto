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
 * - Serve IPC commands over a Unix domain socket
 * - Navigate to the requested URL
 * - Stay alive until the browser disconnects or a signal is received
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

// ── Config schema ──────────────────────────────────────────────────────

type DaemonConfig = {
  port: number;
  url: string;
  session: string;
  headed: boolean;
  viewport: { width: number; height: number };
  storageStatePath?: string;
  windowPosition?: { x: number; y: number };
};

type TelemetryEntry = Record<string, unknown>;

// ── BrowserDaemon ──────────────────────────────────────────────────────

const PROTOCOL_VERSION = 1;
const REQUEST_TIMEOUT_MS = 60_000;

class BrowserDaemon {
  readonly logger: LoggerApi;
  private readonly execState: Record<string, unknown> = {};
  private readonly pageById = new Map<string, Page>();

  private constructor(
    private readonly config: DaemonConfig,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly ipcServer: DaemonServer,
    logger: LoggerApi,
  ) {
    this.logger = logger.withScope("child");
  }

  private trackPage(page: Page): string {
    const id = `page-${Math.random().toString(36).slice(2, 5)}`;
    this.pageById.set(id, page);
    page.on("close", () => this.pageById.delete(id));
    return id;
  }

  static async create(config: DaemonConfig): Promise<BrowserDaemon> {
    await mkdir(getSessionDir(config.session), { recursive: true });

    // Launch browser
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

    // Create context & page
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

    // Telemetry
    const networkLogFile = getSessionNetworkLogPath(config.session);
    const actionsLogFile = getSessionActionsLogPath(config.session);

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

    // Action logging — wrap the initial page and any future pages.
    wrapPageForActionLogging(page, config.session);
    context.on("page", (newPage) => {
      wrapPageForActionLogging(newPage, config.session);
    });

    // IPC server — handler is wired after construction to avoid a
    // circular type inference issue (daemon references itself).
    const socketPath = getDaemonSocketPath(config.session);
    let handler: (request: DaemonRequest) => Promise<unknown>;
    const ipcServer = new DaemonServer(socketPath, (request) =>
      handler(request),
    );
    const logger = createLoggerForSession(config.session);
    const daemon = new BrowserDaemon(
      config,
      browser,
      context,
      page,
      ipcServer,
      logger,
    );

    // Track the initial page and auto-track any pages opened later.
    daemon.trackPage(page);
    context.on("page", (newPage) => {
      daemon.trackPage(newPage);
    });
    handler = (request) => daemon.handleRequest(request);
    await ipcServer.listen();
    daemon.logger.info("ipc-server-listening", { socketPath });

    // Wire browser disconnect after daemon is constructed
    browser.on("disconnected", () => {
      void daemon.shutdown("browser-disconnected-exiting", false);
    });

    // Navigate
    await page.goto(config.url);

    daemon.logger.info("child-launched", {
      port: config.port,
      pid: process.pid,
      session: config.session,
    });

    return daemon;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async shutdown(reason: string, closeBrowser: boolean): Promise<void> {
    this.logger.info(reason, { port: this.config.port });
    await this.ipcServer.close();
    if (closeBrowser) await this.browser.close();
  }

  // ── Page resolution ────────────────────────────────────────────────

  private resolveTargetPage(pageId?: string): Page {
    if (!pageId) {
      if (this.pageById.size > 1) {
        throw new Error(
          `Multiple pages are open in session "${this.config.session}". Pass --page <id> to target a page (run "libretto pages --session ${this.config.session}" to list ids).`,
        );
      }
      return this.page;
    }
    const page = this.pageById.get(pageId);
    if (!page) {
      throw new Error(
        `Page "${pageId}" was not found in session "${this.config.session}". Run "libretto pages --session ${this.config.session}" to list ids.`,
      );
    }
    return page;
  }

  // ── IPC handler ────────────────────────────────────────────────────

  private async handleRequest(request: DaemonRequest): Promise<unknown> {
    if (request.command === "ping") {
      return { protocolVersion: PROTOCOL_VERSION };
    }

    // All non-ping commands get a timeout guard.
    return Promise.race([
      this.dispatchCommand(request),
      new Promise<never>((_resolve, reject) => {
        setTimeout(
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
          this.config.session,
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
          this.config.session,
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
  const config: DaemonConfig = JSON.parse(process.argv[2]);
  const daemon = await BrowserDaemon.create(config);

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
      port: config.port,
    });
  });

  // The process stays alive as long as the IPC server and browser
  // connection hold the event loop open. shutdown() closes both,
  // letting the process exit naturally.
}

await main();
