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

import { chromium, type Browser } from "playwright";
import { mkdir } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { installSessionTelemetry } from "./session-telemetry.js";
import {
  getSessionDir,
  getSessionLogsPath,
  getSessionNetworkLogPath,
  getSessionActionsLogPath,
} from "./context.js";
import {
  DaemonServer,
  getDaemonSocketPath,
  type DaemonRequest,
} from "./daemon-ipc.js";

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

class BrowserDaemon {
  private readonly logFile: string;

  private constructor(
    private readonly config: DaemonConfig,
    private readonly browser: Browser,
    private readonly ipcServer: DaemonServer,
  ) {
    this.logFile = getSessionLogsPath(config.session);
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

    // IPC server — handler is wired after construction to avoid a
    // circular type inference issue (daemon references itself).
    const socketPath = getDaemonSocketPath(config.session);
    let handler: (request: DaemonRequest) => Promise<unknown>;
    const ipcServer = new DaemonServer(socketPath, (request) =>
      handler(request),
    );
    const daemon = new BrowserDaemon(config, browser, ipcServer);
    handler = (request) => daemon.handleRequest(request);
    await ipcServer.listen();
    daemon.log("info", "ipc-server-listening", { socketPath });

    // Wire browser disconnect after daemon is constructed
    browser.on("disconnected", () => {
      void daemon.shutdown("browser-disconnected-exiting", false);
    });

    // Navigate
    await page.goto(config.url);

    daemon.log("info", "child-launched", {
      port: config.port,
      pid: process.pid,
      session: config.session,
    });

    return daemon;
  }

  // ── Logging ────────────────────────────────────────────────────────

  log(level: string, event: string, data: Record<string, unknown> = {}): void {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      id: Math.random().toString(36).slice(2, 10),
      level,
      scope: "libretto.child",
      event,
      data,
    });
    appendFileSync(this.logFile, entry + "\n");
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async shutdown(reason: string, closeBrowser: boolean): Promise<void> {
    this.log("info", reason, { port: this.config.port });
    await this.ipcServer.close();
    if (closeBrowser) await this.browser.close();
  }

  // ── IPC handler ────────────────────────────────────────────────────

  private async handleRequest(request: DaemonRequest): Promise<unknown> {
    switch (request.command) {
      case "ping":
        return { protocolVersion: PROTOCOL_VERSION };
      default:
        throw new Error(`Unknown command: ${request.command}`);
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
    daemon.log("error", "uncaught-exception", {
      message: err.message,
      stack: err.stack,
    });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    daemon.log("warn", "unhandled-rejection", { reason: String(reason) });
  });

  process.on("exit", (code) => {
    daemon.log("info", "child-exit", {
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
