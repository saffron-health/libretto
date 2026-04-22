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
import { mkdir, unlink } from "node:fs/promises";
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
