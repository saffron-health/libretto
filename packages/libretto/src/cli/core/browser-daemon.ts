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

import { chromium, type Page } from "playwright";
import { appendFile, mkdir, unlink } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { installSessionTelemetry } from "./session-telemetry.js";
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
};

const config: DaemonConfig = JSON.parse(process.argv[2]);

// ── Derived paths ──────────────────────────────────────────────────────

const sessionDir = getSessionDir(config.session);
await mkdir(sessionDir, { recursive: true });

const logFile = getSessionLogsPath(config.session);
const networkLogFile = getSessionNetworkLogPath(config.session);
const actionsLogFile = getSessionActionsLogPath(config.session);

type TelemetryEntry = Record<string, unknown>;

async function childLog(
  level: string,
  event: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    id: Math.random().toString(36).slice(2, 10),
    level,
    scope: "libretto.child",
    event,
    data,
  });
  await appendFile(logFile, entry + "\n");
}

async function logAction(entry: TelemetryEntry): Promise<void> {
  await appendFile(actionsLogFile, JSON.stringify(entry) + "\n");
}

async function logNetwork(entry: TelemetryEntry): Promise<void> {
  await appendFile(networkLogFile, JSON.stringify(entry) + "\n");
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
    await childLog("info", reason, { port: config.port });
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

// ── Track pages — close browser when all pages are closed ──────────────

function trackPage(p: Page): void {
  p.on("close", async () => {
    const remaining = context
      .pages()
      .filter(
        (pg) =>
          !pg.isClosed() &&
          !pg.url().startsWith("devtools://") &&
          !pg.url().startsWith("chrome-error://"),
      );
    await childLog("info", "page-closed", {
      closedUrl: p.url(),
      remainingPages: remaining.length,
    });
    if (remaining.length === 0 && !shuttingDown) {
      await childLog("info", "all-pages-closed-shutting-down");
      await browser.close();
    }
  });
}

trackPage(page);
context.on("page", (newPage) => trackPage(newPage));

// ── Navigate ───────────────────────────────────────────────────────────

await page.goto(config.url);

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
  }).finally(() => process.exit(1));
});

process.on("unhandledRejection", async (reason) => {
  await childLog("warn", "unhandled-rejection", { reason: String(reason) });
});

process.on("exit", (code) => {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    id: Math.random().toString(36).slice(2, 10),
    level: "info",
    scope: "libretto.child",
    event: "child-exit",
    data: { code, pid: process.pid, port: config.port },
  });
  appendFileSync(logFile, entry + "\n");
});

await childLog("info", "child-launched", {
  port: config.port,
  pid: process.pid,
  session: config.session,
});

// Keep the daemon alive until the browser disconnects or a signal arrives.
await sleepPromise;
process.exit(0);
