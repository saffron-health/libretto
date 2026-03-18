import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { openSync, existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import type { LoggerApi } from "../../shared/logger/index.js";
import {
  getSessionActionsLogPath,
  getSessionNetworkLogPath,
  PROFILES_DIR,
} from "./context.js";
import { readLibrettoConfig } from "./ai-config.js";
import {
  assertSessionAvailableForStart,
  clearSessionState,
  listSessionsWithStateFile,
  readSessionStateOrThrow,
  logFileForSession,
  readSessionState,
  writeSessionState,
} from "./session.js";
import { installSessionTelemetry } from "./session-telemetry.js";

const CLOSE_WAIT_MS = 1_500;
const FORCE_CLOSE_WAIT_MS = 300;

async function pickFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to pick free port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

export function normalizeUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) {
    return `https://${url}`;
  }
  return url;
}

export function normalizeDomain(url: string): string {
  try {
    const u = new URL(normalizeUrl(url));
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^www\./, "");
  }
}

export function getProfilePath(domain: string): string {
  return join(PROFILES_DIR, `${domain}.json`);
}

export function hasProfile(domain: string): boolean {
  return existsSync(getProfilePath(domain));
}

async function tryConnectToPort(
  port: number,
  logger: LoggerApi,
  timeoutMs: number = 5000,
): Promise<Browser | null> {
  const endpoint = `http://localhost:${port}`;
  logger.info("cdp-connect-attempt", { port, endpoint, timeoutMs });
  try {
    const connectPromise = chromium.connectOverCDP(endpoint);
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs),
    );
    const browser = await Promise.race([connectPromise, timeoutPromise]);
    if (browser) {
      logger.info("cdp-connect-success", {
        port,
        endpoint,
        contexts: browser.contexts().length,
      });
    } else {
      logger.warn("cdp-connect-timeout", { port, endpoint, timeoutMs });
    }
    return browser;
  } catch (err) {
    logger.error("cdp-connect-error", { error: err, port, endpoint });
    return null;
  }
}

function isOperationalPage(page: Page): boolean {
  const url = page.url();
  return !url.startsWith("devtools://") && !url.startsWith("chrome-error://");
}

export function disconnectBrowser(
  browser: Browser,
  logger: LoggerApi,
  session?: string,
): void {
  logger.info("cdp-disconnect", { session });
  try {
    (browser as any)._connection?.close();
  } catch (err) {
    logger.warn("cdp-disconnect-already-closed", { error: err });
  }
}

function resolveOperationalPages(browser: Browser): Page[] {
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter(isOperationalPage);
}

type PageReference = {
  id: string;
  page: Page;
};

export type OpenPageSummary = {
  id: string;
  url: string;
  active: boolean;
};

async function resolvePageId(page: Page): Promise<string> {
  const cdpSession: CDPSession = await page.context().newCDPSession(page);
  try {
    const targetInfo = await cdpSession.send("Target.getTargetInfo");
    const targetId = (targetInfo as { targetInfo?: { targetId?: unknown } })?.targetInfo
      ?.targetId;
    if (typeof targetId !== "string" || targetId.length === 0) {
      throw new Error(`Could not resolve target id for page at URL "${page.url()}".`);
    }
    return targetId;
  } finally {
    await cdpSession.detach();
  }
}

async function resolvePageReferences(pages: Page[]): Promise<PageReference[]> {
  const refs = await Promise.all(
    pages.map(async (page) => {
      const id = await resolvePageId(page);
      return { id, page };
    }),
  );
  return refs;
}

export async function listOpenPages(
  session: string,
  logger: LoggerApi,
): Promise<OpenPageSummary[]> {
  const { browser, page: activePage } = await connect(session, logger);
  try {
    const pages = browser.contexts().flatMap((ctx) => ctx.pages()).filter(isOperationalPage);
    const pageRefs = await resolvePageReferences(pages);
    return pageRefs.map(({ id, page }) => ({
      id,
      url: page.url(),
      active: page === activePage,
    }));
  } finally {
    disconnectBrowser(browser, logger, session);
  }
}

export async function connect(
  session: string,
  logger: LoggerApi,
  timeoutMs: number = 10000,
  options?: {
    pageId?: string;
    requireSinglePage?: boolean;
  },
): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
  pageId: string;
}> {
  logger.info("connect", { session, timeoutMs });
  const state = readSessionStateOrThrow(session);
  const browser = await tryConnectToPort(state.port, logger, timeoutMs);
  if (!browser) {
    logger.error("connect-no-browser", {
      session,
      port: state.port,
      pid: state.pid,
    });
    if (!isPidRunning(state.pid)) {
      clearSessionState(session, logger);
      throw new Error(
        `No browser running for session "${session}". Run 'libretto open <url> --session ${session}' first.`,
      );
    }

    throw new Error(
      `Could not connect to the browser for session "${session}" at http://127.0.0.1:${state.port}, but the session process (pid ${state.pid}) is still running. Try the command again, or close and reopen the session if it stays stuck.`,
    );
  }

  const contexts = browser.contexts();
  logger.info("connect-contexts", { session, contextCount: contexts.length });
  if (contexts.length === 0) {
    logger.error("connect-no-contexts", { session });
    throw new Error("No browser context found.");
  }

  const allPages = contexts.flatMap((c) => c.pages());
  const pages = resolveOperationalPages(browser);

  logger.info("connect-pages", {
    session,
    totalPages: allPages.length,
    filteredPages: pages.length,
    urls: allPages.map((p) => p.url()),
  });

  if (pages.length === 0) {
    logger.error("connect-no-pages", {
      session,
      allPageUrls: allPages.map((p) => p.url()),
    });
    throw new Error("No pages found.");
  }

  if (options?.requireSinglePage && !options.pageId && pages.length > 1) {
    throw new Error(
      `Multiple pages are open in session "${session}". Pass --page <id> to target a page (run "libretto pages --session ${session}" to list ids).`,
    );
  }

  const pageRefs = await resolvePageReferences(pages);
  const pageRef = options?.pageId
    ? (pageRefs.find((ref) => ref.id === options.pageId) ?? null)
    : pageRefs[pageRefs.length - 1]!;
  if (!pageRef) {
    throw new Error(
      `Page "${options?.pageId}" was not found in session "${session}". Run "libretto pages --session ${session}" to list ids.`,
    );
  }
  const page = pageRef.page;
  const context = page.context();

  page.on("close", () => {
    logger.error("page-closed-during-command", {
      session,
      url: page.url(),
      trace: new Error("page-closed-trace").stack,
    });
  });
  page.on("crash", () => {
    logger.error("page-crashed-during-command", {
      session,
      url: page.url(),
    });
  });
  browser.on("disconnected", () => {
    logger.error("browser-disconnected-during-command", {
      session,
      trace: new Error("browser-disconnected-trace").stack,
    });
  });

  logger.info("connect-success", { session, pageUrl: page.url() });
  return { browser, context, page, pageId: pageRef.id };
}

export async function runPages(session: string, logger: LoggerApi): Promise<void> {
  logger.info("pages-start", { session });
  const pageSummaries = await listOpenPages(session, logger);

  if (pageSummaries.length === 0) {
    console.log("No pages found.");
    return;
  }

  console.log("Open pages:");
  pageSummaries.forEach((pageSummary) => {
    const activeSuffix = pageSummary.active ? " active=true" : "";
    console.log(`  id=${pageSummary.id} url=${pageSummary.url}${activeSuffix}`);
  });
}

const DEFAULT_VIEWPORT = { width: 1366, height: 768 } as const;

export function resolveViewport(
  cliViewport: { width: number; height: number } | undefined,
  logger: LoggerApi,
): { width: number; height: number } {
  if (cliViewport) {
    logger.info("viewport-source", { source: "cli", viewport: cliViewport });
    return cliViewport;
  }
  const config = readLibrettoConfig();
  if (config.viewport) {
    logger.info("viewport-source", { source: "config", viewport: config.viewport });
    return config.viewport;
  }
  logger.info("viewport-source", { source: "default", viewport: DEFAULT_VIEWPORT });
  return DEFAULT_VIEWPORT;
}

export async function runOpen(
  rawUrl: string,
  headed: boolean,
  session: string,
  logger: LoggerApi,
  options?: { viewport?: { width: number; height: number } },
): Promise<void> {
  const url = normalizeUrl(rawUrl);
  const viewport = resolveViewport(options?.viewport, logger);
  logger.info("open-start", { url, headed, session, viewport });
  assertSessionAvailableForStart(session, logger);

  const port = await pickFreePort();
  const runLogPath = logFileForSession(session);
  const networkLogPath = getSessionNetworkLogPath(session);
  const actionsLogPath = getSessionActionsLogPath(session);

  const browserMode = headed ? "headed" : "headless";
  const domain = normalizeDomain(url);
  const profilePath = getProfilePath(domain);
  const useProfile = hasProfile(domain);

  logger.info("open-launching", {
    url,
    mode: browserMode,
    session,
    port,
    domain,
    useProfile,
    profilePath: useProfile ? profilePath : undefined,
  });

  if (useProfile) {
    console.log(`Loading saved profile for ${domain}`);
  }
  console.log(`Launching ${browserMode} browser (session: ${session})...`);

  const escapedProfilePath = profilePath
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
  const escapedUrl = url.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const storageStateCode = useProfile
    ? `storageState: '${escapedProfilePath}',`
    : "";

  const escapedLogPath = runLogPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const escapedNetworkLogPath = networkLogPath
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
  const escapedActionsLogPath = actionsLogPath
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");

  const launcherCode = `
import { chromium } from 'playwright';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const LOG_FILE = '${escapedLogPath}';
const NETWORK_LOG = '${escapedNetworkLogPath}';
const ACTIONS_LOG = '${escapedActionsLogPath}';
mkdirSync(dirname(NETWORK_LOG), { recursive: true });

// tsx/esbuild may emit __name() wrappers in Function#toString output.
const __name = (target, value) =>
	Object.defineProperty(target, 'name', { value, configurable: true });

${installSessionTelemetry.toString()}

function logAction(entry) {
	appendFileSync(ACTIONS_LOG, JSON.stringify(entry) + '\\n');
}

function logNetwork(entry) {
	appendFileSync(NETWORK_LOG, JSON.stringify(entry) + '\\n');
}

function childLog(level, event, data = {}) {
	try {
		const entry = JSON.stringify({
			timestamp: new Date().toISOString(),
			id: Math.random().toString(36).slice(2, 10),
			level,
			scope: 'libretto.child',
			event,
			data,
		});
		appendFileSync(LOG_FILE, entry + '\\n');
	} catch {}
}

const browser = await chromium.launch({
	headless: ${!headed},
	args: ['--disable-blink-features=AutomationControlled', '--remote-debugging-port=${port}', '--remote-debugging-address=127.0.0.1', '--no-focus-on-check'],
});

browser.on('disconnected', () => {
	childLog('warn', 'browser-disconnected', { port: ${port} });
});

const context = await browser.newContext({
	${storageStateCode}
	viewport: { width: ${viewport.width}, height: ${viewport.height} },
	userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
});

const page = await context.newPage();
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(45000);

await installSessionTelemetry({
	context,
	initialPage: page,
	includeUserDomActions: true,
	logAction,
	logNetwork,
});


await page.goto('${escapedUrl}');

process.on('SIGTERM', async () => {
	childLog('info', 'child-sigterm');
	await browser.close();
	process.exit(0);
});

process.on('SIGINT', async () => {
	childLog('info', 'child-sigint');
	await browser.close();
	process.exit(0);
});

process.on('uncaughtException', (err) => {
	childLog('error', 'uncaught-exception', { message: err.message, stack: err.stack });
	process.exit(1);
});

process.on('unhandledRejection', (reason) => {
	childLog('warn', 'unhandled-rejection', { reason: String(reason) });
});

process.on('exit', (code) => {
	childLog('info', 'child-exit', { code, pid: process.pid, port: ${port} });
});

childLog('info', 'child-launched', { port: ${port}, pid: process.pid, session: '${session}' });

await new Promise(() => {});
`;

  const childStderrFd = openSync(runLogPath, "a");

  const child = spawn("node", ["--input-type=module", "-e", launcherCode], {
    detached: true,
    stdio: ["ignore", "ignore", childStderrFd],
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
  });
  child.unref();

  logger.info("open-child-spawned", { pid: child.pid, port, session });

  let childSpawnError: Error | null = null;
  let childEarlyExit: { code: number | null; signal: NodeJS.Signals | null } | null =
    null;

  child.on("error", (err) => {
    childSpawnError = err;
    logger.error("open-child-spawn-error", { error: err, session, port });
  });

  child.on("exit", (code, signal) => {
    childEarlyExit = { code, signal };
    logger.warn("open-child-exited", {
      code,
      signal,
      session,
      port,
      pid: child.pid,
    });
  });

  const cdpPollIntervalMs = 500;
  const cdpMaxAttempts = 30;
  const cdpStartupTimeoutMs = cdpPollIntervalMs * cdpMaxAttempts;

  for (let i = 0; i < cdpMaxAttempts; i++) {
    const spawnError = childSpawnError as Error | null;
    if (spawnError !== null) {
      const errWithCode = spawnError as Error & { code?: string };
      const hint =
        errWithCode.code === "ENOENT"
          ? " Ensure Node.js is available in PATH for child processes."
          : "";
      throw new Error(
        `Failed to launch browser child process: ${spawnError.message}.${hint} Check logs: ${runLogPath}`,
      );
    }

    const earlyExit = childEarlyExit as {
      code: number | null;
      signal: NodeJS.Signals | null;
    } | null;
    if (earlyExit !== null) {
      const status = earlyExit.code ?? earlyExit.signal ?? "unknown";
      throw new Error(
        `Browser child process exited before startup (status: ${status}). Check logs: ${runLogPath}`,
      );
    }

    await new Promise((r) => setTimeout(r, cdpPollIntervalMs));
    const ready = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then(() => true)
      .catch(() => false);
    if (i > 0 && i % 5 === 0) {
      logger.info("open-waiting-for-cdp", { attempt: i, port, session });
    }
    if (ready) {
      writeSessionState({
        port,
        pid: child.pid!,
        session,
        startedAt: new Date().toISOString(),
        status: "active",
        viewport,
      }, logger);
      logger.info("open-success", {
        url,
        mode: browserMode,
        session,
        port,
        pid: child.pid,
      });
      console.log(`Browser open (${browserMode}): ${url}`);

      await new Promise((r) => setTimeout(r, 2000));
      return;
    }
  }

  logger.error("open-timeout", {
    session,
    port,
    pid: child.pid,
    attempts: cdpMaxAttempts,
  });
  throw new Error(
    `Failed to connect to browser after ${Math.ceil(cdpStartupTimeoutMs / 1000)}s. Check startup logs: ${runLogPath}`,
  );
}

export async function runSave(
  urlOrDomain: string,
  session: string,
  logger: LoggerApi,
): Promise<void> {
  logger.info("save-start", { urlOrDomain, session });
  const { browser, context, page } = await connect(session, logger);

  try {
    await new Promise((r) => setTimeout(r, 500));

    const domain = normalizeDomain(urlOrDomain);
    const profilePath = getProfilePath(domain);

    const cdpSession = await context.newCDPSession(page);
    const { cookies: rawCookies } = await cdpSession.send(
      "Network.getAllCookies",
    );

    const cookies = rawCookies.map((c: any) => {
      const cookie = { ...c };
      if (cookie.partitionKey && typeof cookie.partitionKey === "object") {
        delete cookie.partitionKey;
      }
      return cookie;
    });

    await cdpSession.detach();

    const origins: Array<{
      origin: string;
      localStorage: Array<{ name: string; value: string }>;
    }> = [];

    for (const ctx of browser.contexts()) {
      for (const pg of ctx.pages()) {
        try {
          const origin = new URL(pg.url()).origin;
          const localStorage = await pg.evaluate(() => {
            const items: Array<{ name: string; value: string }> = [];
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i);
              if (key) {
                items.push({
                  name: key,
                  value: window.localStorage.getItem(key) || "",
                });
              }
            }
            return items;
          });
          if (localStorage.length > 0) {
            origins.push({ origin, localStorage });
          }
        } catch {
          // Skip pages that can't be accessed.
        }
      }
    }

    const state = { cookies, origins };
    const fs = await import("node:fs/promises");
    await fs.mkdir(dirname(profilePath), { recursive: true });
    await fs.writeFile(profilePath, JSON.stringify(state, null, 2));

    logger.info("save-success", {
      domain,
      profilePath,
      cookieCount: cookies.length,
      originCount: origins.length,
    });
    console.log(`Profile saved for ${domain}`);
    console.log(`   Location: ${profilePath}`);
    console.log(`   Cookies: ${cookies.length}, Origins: ${origins.length}`);
  } catch (err) {
    logger.error("save-error", { error: err, urlOrDomain, session });
    throw err;
  } finally {
    disconnectBrowser(browser, logger, session);
  }
}

export async function runClose(session: string, logger: LoggerApi): Promise<void> {
  logger.info("close-start", { session });
  const state = readSessionState(session, logger);
  if (!state) {
    logger.info("close-no-session", { session });
    console.log(`No browser running for session "${session}".`);
    return;
  }

  logger.info("close-killing", { session, pid: state.pid, port: state.port });

  sendSignalToProcessGroupOrPid(state.pid, "SIGTERM", logger, session);

  await waitForCloseSignalWindow(CLOSE_WAIT_MS);

  clearSessionState(session, logger);
  logger.info("close-success", { session });
  console.log(`Browser closed (session: ${session}).`);
}

type ClosableSession = {
  session: string;
  pid: number;
  port: number;
};

function waitForCloseSignalWindow(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sendSignalToProcessGroupOrPid(
  pid: number,
  signal: NodeJS.Signals,
  logger: LoggerApi,
  session: string,
): void {
  try {
    process.kill(pid, signal);
    logger.info("close-signal-pid", { session, pid, signal });
  } catch (pidErr) {
    const pidCode = (pidErr as NodeJS.ErrnoException).code;
    if (pidCode !== "ESRCH") {
      logger.warn("close-signal-pid-failed", {
        session,
        pid,
        signal,
        error: pidErr,
      });
    }
  }
}

function formatSessionList(targets: ReadonlyArray<{ session: string }>): string {
  return targets.map((target) => `"${target.session}"`).join(", ");
}

function resolveClosableSessions(logger: LoggerApi): {
  closable: ClosableSession[];
  clearedUnreadableStates: number;
} {
  const sessions = listSessionsWithStateFile();
  const closable: ClosableSession[] = [];
  let clearedUnreadableStates = 0;
  for (const session of sessions) {
    const state = readSessionState(session, logger);
    if (!state) {
      clearSessionState(session, logger);
      clearedUnreadableStates += 1;
      continue;
    }
    closable.push({
      session,
      pid: state.pid,
      port: state.port,
    });
  }

  return { closable, clearedUnreadableStates };
}

function clearStoppedSessionStates(
  sessions: ReadonlyArray<ClosableSession>,
  logger: LoggerApi,
): number {
  let cleared = 0;
  for (const session of sessions) {
    if (!isPidRunning(session.pid)) {
      clearSessionState(session.session, logger);
      cleared += 1;
    }
  }
  return cleared;
}

export async function runCloseAll(
  logger: LoggerApi,
  options?: { force?: boolean },
): Promise<void> {
  const force = Boolean(options?.force);
  logger.info("close-all-start", { force });
  const { closable, clearedUnreadableStates } = resolveClosableSessions(logger);
  if (closable.length === 0) {
    if (clearedUnreadableStates > 0) {
      console.log(
        `Cleared ${clearedUnreadableStates} unreadable session state file(s).`,
      );
    }
    console.log("No browser sessions found.");
    return;
  }

  for (const target of closable) {
    logger.info("close-all-sigterm", {
      session: target.session,
      pid: target.pid,
      port: target.port,
    });
    sendSignalToProcessGroupOrPid(target.pid, "SIGTERM", logger, target.session);
  }

  await waitForCloseSignalWindow(CLOSE_WAIT_MS);

  let survivors = closable.filter((target) => isPidRunning(target.pid));
  if (survivors.length > 0 && !force) {
    const closed = clearStoppedSessionStates(closable, logger);

    throw new Error(
      [
        `Failed to close ${survivors.length} session(s) gracefully: ${formatSessionList(survivors)}.`,
        `Closed ${closed} session(s).`,
        `Retry with: libretto close --all --force`,
      ].join("\n"),
    );
  }

  let forceKilled = 0;
  if (survivors.length > 0) {
    for (const survivor of survivors) {
      logger.warn("close-all-sigkill", {
        session: survivor.session,
        pid: survivor.pid,
      });
      sendSignalToProcessGroupOrPid(survivor.pid, "SIGKILL", logger, survivor.session);
      forceKilled += 1;
    }
    await waitForCloseSignalWindow(FORCE_CLOSE_WAIT_MS);
    survivors = survivors.filter((target) => isPidRunning(target.pid));
    if (survivors.length > 0) {
      const closed = clearStoppedSessionStates(closable, logger);
      throw new Error(
        [
          `Failed to force-close ${survivors.length} session(s): ${formatSessionList(survivors)}.`,
          `Closed ${closed} session(s).`,
        ].join("\n"),
      );
    }
  }

  clearStoppedSessionStates(closable, logger);

  if (clearedUnreadableStates > 0) {
    console.log(
      `Cleared ${clearedUnreadableStates} unreadable session state file(s).`,
    );
  }
  console.log(`Closed ${closable.length} session(s).`);
  if (forceKilled > 0) {
    console.log(`Force-killed ${forceKilled} session(s).`);
  }
}

export function resolvePath(filePath: string): string {
  return join(process.cwd(), filePath);
}

export function getScreenshotBaseName(title: string): string {
  const sanitizedTitle = title
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 50);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${sanitizedTitle}-${timestamp}`;
}
