import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { createServer } from "node:net";
import type { LoggerApi } from "../../shared/logger/index.js";
import type { SessionAccessMode } from "../../shared/state/index.js";
import { getSessionProviderClosePath, PROFILES_DIR } from "./context.js";
import { readLibrettoConfig } from "./config.js";
import {
  assertSessionAvailableForStart,
  clearSessionState,
  isPidRunning,
  listSessionsWithStateFile,
  readSessionStateOrThrow,
  logFileForSession,
  readSessionState,
  writeSessionState,
} from "./session.js";
import { DaemonClient } from "./daemon/index.js";

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

function tryParseAbsoluteUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isLikelyHostWithPort(parsedUrl: URL, rawUrl: string): boolean {
  // `new URL("localhost:3000")` parses successfully, but treats `localhost:`
  // as a custom scheme instead of a bare host with port. Detect that shape so
  // CLI shorthand like `libretto open localhost:3000` still normalizes to
  // `https://localhost:3000/`.
  const remainder = rawUrl.slice(parsedUrl.protocol.length);
  if (remainder.length === 0) return false;

  let index = 0;
  while (index < remainder.length) {
    const charCode = remainder.charCodeAt(index);
    if (charCode < 48 || charCode > 57) break;
    index += 1;
  }

  if (index === 0) return false;
  if (index === remainder.length) return true;

  const nextChar = remainder[index];
  return nextChar === "/" || nextChar === "?" || nextChar === "#";
}

export function normalizeUrl(url: string): URL {
  const parsedUrl = tryParseAbsoluteUrl(url);
  if (!parsedUrl) {
    return new URL(`https://${url}`);
  }

  if (
    parsedUrl.protocol === "http:" ||
    parsedUrl.protocol === "https:" ||
    parsedUrl.protocol === "file:"
  ) {
    return parsedUrl;
  }

  if (isLikelyHostWithPort(parsedUrl, url)) {
    return new URL(`https://${url}`);
  }

  throw new Error(
    `Unsupported URL protocol: ${parsedUrl.protocol}. Use http://, https://, or file://.`,
  );
}

export function normalizeDomain(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

export function getProfilePath(domain: string): string {
  return join(PROFILES_DIR, `${domain}.json`);
}

export function hasProfile(domain: string): boolean {
  return existsSync(getProfilePath(domain));
}

async function tryConnectToCDP(
  endpoint: string,
  logger: LoggerApi,
  timeoutMs: number = 5000,
): Promise<Browser | null> {
  logger.info("cdp-connect-attempt", { endpoint, timeoutMs });
  try {
    const connectPromise = chromium.connectOverCDP(endpoint);
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs),
    );
    const browser = await Promise.race([connectPromise, timeoutPromise]);
    if (browser) {
      logger.info("cdp-connect-success", {
        endpoint,
        contexts: browser.contexts().length,
      });
    } else {
      logger.warn("cdp-connect-timeout", { endpoint, timeoutMs });
    }
    return browser;
  } catch (err) {
    logger.error("cdp-connect-error", { error: err, endpoint });
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
    const targetId = (targetInfo as { targetInfo?: { targetId?: unknown } })
      ?.targetInfo?.targetId;
    if (typeof targetId !== "string" || targetId.length === 0) {
      throw new Error(
        `Could not resolve target id for page at URL "${page.url()}".`,
      );
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
  const endpoint = state.cdpEndpoint ?? `http://localhost:${state.port}`;
  const browser = await tryConnectToCDP(endpoint, logger, timeoutMs);
  if (!browser) {
    logger.error("connect-no-browser", {
      session,
      endpoint,
      pid: state.pid,
    });
    // Provider sessions have no local PID to check liveness.
    // Don't destroy the remote session on a transient failure —
    // let the user retry or explicitly close.
    if (state.provider) {
      throw new Error(
        `Could not connect to ${state.provider.name} session for "${session}" at ${endpoint}. ` +
          `The remote session may still be active. Try again, or close with: libretto close --session ${session}`,
      );
    }

    if (state.pid == null || !isPidRunning(state.pid)) {
      clearSessionState(session, logger);
      throw new Error(
        `No browser running for session "${session}". Run 'libretto open <url> --session ${session}' first.`,
      );
    }

    throw new Error(
      `Could not connect to the browser for session "${session}" at ${endpoint}, but the session process (pid ${state.pid}) is still running. Try the command again, or close and reopen the session if it stays stuck.`,
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

export async function runPages(
  session: string,
  logger: LoggerApi,
): Promise<void> {
  logger.info("pages-start", { session });

  const state = readSessionStateOrThrow(session);
  let pageSummaries: OpenPageSummary[];

  if (!state.daemonSocketPath) {
    throw new Error(
      `Session "${session}" has no daemon socket. The browser daemon may have crashed. ` +
        `Close and reopen the session: libretto close --session ${session}`,
    );
  }
  const client = new DaemonClient(state.daemonSocketPath);
  pageSummaries = await client.pages();

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
    logger.info("viewport-source", {
      source: "config",
      viewport: config.viewport,
    });
    return config.viewport;
  }
  logger.info("viewport-source", {
    source: "default",
    viewport: DEFAULT_VIEWPORT,
  });
  return DEFAULT_VIEWPORT;
}

function resolveWindowPosition(
  logger: LoggerApi,
): { x: number; y: number } | undefined {
  const config = readLibrettoConfig();
  if (config.windowPosition) {
    logger.info("window-position-source", {
      source: "config",
      windowPosition: config.windowPosition,
    });
    return config.windowPosition;
  }
  return undefined;
}

export async function runOpen(
  rawUrl: string,
  headed: boolean,
  session: string,
  logger: LoggerApi,
  options?: {
    viewport?: { width: number; height: number };
    accessMode?: SessionAccessMode;
    authProfileDomain?: string;
  },
): Promise<void> {
  const parsedUrl = normalizeUrl(rawUrl);
  const url = parsedUrl.href;
  const viewport = resolveViewport(options?.viewport, logger);
  const accessMode = options?.accessMode ?? "write-access";
  const windowPosition = headed ? resolveWindowPosition(logger) : undefined;
  logger.info("open-start", {
    url,
    headed,
    session,
    viewport,
    windowPosition,
    accessMode,
  });
  assertSessionAvailableForStart(session, logger);

  const port = await pickFreePort();
  const runLogPath = logFileForSession(session);

  const browserMode = headed ? "headed" : "headless";

  // When --auth-profile is provided, use that domain for profile lookup
  // instead of deriving it from the URL.
  const authDomain = options?.authProfileDomain
    ? normalizeDomain(normalizeUrl(options.authProfileDomain))
    : undefined;
  if (authDomain) {
    const authProfilePath = getProfilePath(authDomain);
    if (!existsSync(authProfilePath)) {
      throw new Error(
        `No saved auth profile for "${authDomain}". ` +
          `Save one first: libretto open https://${authDomain} --headed --session <name>, ` +
          `log in, then run: libretto save ${authDomain} --session <name>`,
      );
    }
  }

  const supportsSavedProfile =
    parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  const domain = authDomain ?? (supportsSavedProfile ? normalizeDomain(parsedUrl) : undefined);
  const profilePath = domain ? getProfilePath(domain) : undefined;
  const useProfile = domain ? hasProfile(domain) : false;

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

  // Spawn daemon and wait for IPC readiness. The daemon launches
  // Chromium internally — IPC readiness implies the browser is up,
  // so no separate CDP polling is needed.
  const { pid, socketPath: daemonSocketPath } = await DaemonClient.spawn({
    config: {
      session,
      browser: {
        kind: "launch",
        headed,
        viewport,
        storageStatePath: useProfile ? profilePath : undefined,
        windowPosition,
        remoteDebuggingPort: port,
        initialUrl: url,
      },
    },
    logger,
    logPath: runLogPath,
    // The daemon launches Chromium, installs telemetry, navigates to
    // the URL, and only then starts IPC. Navigation alone can take up
    // to 45s (page.setDefaultNavigationTimeout), so the IPC timeout
    // must cover launch + navigation.
    startupTimeoutMs: 60_000,
  });

  writeSessionState(
    {
      port,
      pid,
      session,
      startedAt: new Date().toISOString(),
      status: "active",
      mode: accessMode,
      viewport,
      daemonSocketPath,
    },
    logger,
  );

  logger.info("open-success", {
    url,
    mode: browserMode,
    session,
    port,
    pid,
  });
  console.log(`Browser open (${browserMode}): ${url}`);
}

export async function runOpenWithProvider(
  rawUrl: string,
  providerName: string,
  session: string,
  logger: LoggerApi,
  accessMode: SessionAccessMode = "write-access",
): Promise<void> {
  const parsedUrl = normalizeUrl(rawUrl);
  const url = parsedUrl.href;
  logger.info("open-provider-start", { url, provider: providerName, session });

  console.log(
    `Creating ${providerName} browser session (session: ${session})...`,
  );

  console.log(`Connecting to ${providerName} browser...`);

  const runLogPath = logFileForSession(session);
  const {
    pid,
    socketPath: daemonSocketPath,
    provider: providerSession,
  } = await DaemonClient.spawn({
    config: {
      session,
      browser: {
        kind: "provider",
        providerName,
        initialUrl: url,
      },
    },
    logger,
    logPath: runLogPath,
    // Remote CDP connection + navigation; must cover both.
    startupTimeoutMs: 60_000,
  });

  if (!providerSession) {
    throw new Error(
      `Provider daemon did not return session metadata for ${providerName}.`,
    );
  }

  logger.info("open-provider-session-created", {
    provider: providerName,
    sessionId: providerSession.sessionId,
    cdpEndpoint: providerSession.cdpEndpoint,
    liveViewUrl: providerSession.liveViewUrl,
  });

  if (providerSession.liveViewUrl) {
    console.log(`View live session: ${providerSession.liveViewUrl}`);
  }

  writeSessionState(
    {
      port: 0,
      pid,
      cdpEndpoint: providerSession.cdpEndpoint,
      session,
      startedAt: new Date().toISOString(),
      status: "active",
      mode: accessMode,
      daemonSocketPath,
      provider: {
        name: providerName,
        sessionId: providerSession.sessionId,
      },
    },
    logger,
  );

  logger.info("open-provider-success", {
    url,
    provider: providerName,
    session,
    sessionId: providerSession.sessionId,
  });
  console.log(`Browser open (${providerName}): ${url}`);
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

    const domain = normalizeDomain(normalizeUrl(urlOrDomain));
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

export async function runClose(
  session: string,
  logger: LoggerApi,
): Promise<void> {
  logger.info("close-start", { session });
  const state = readSessionState(session, logger);
  if (!state) {
    logger.info("close-no-session", { session });
    console.log(`No browser running for session "${session}".`);
    return;
  }

  // Kill local daemon process if present (applies to both local and
  // provider sessions — the daemon disconnects without closing the
  // external browser).
  if (state.pid != null) {
    logger.info("close-killing", { session, pid: state.pid, port: state.port });
    sendSignalToProcessGroupOrPid(state.pid, "SIGTERM", logger, session);
    await waitForCloseSignalWindow(CLOSE_WAIT_MS);
  }

  // Provider-backed sessions are owned by the daemon. Killing the daemon above
  // makes it close the remote provider session during shutdown.
  let replayUrl: string | undefined;
  if (state.provider) {
    logger.info("close-provider-skipped-daemon-owned", {
      session,
      provider: state.provider.name,
      sessionId: state.provider.sessionId,
    });
    replayUrl = readProviderReplayUrl(session, logger);
  }

  unlinkDaemonSocket(state.daemonSocketPath, logger, session);
  clearSessionState(session, logger);
  logger.info("close-success", { session, replayUrl });
  console.log(`Browser closed (session: ${session}).`);
  if (replayUrl) {
    console.log(`View recording: ${replayUrl}`);
  }
}

type ClosableSession = {
  session: string;
  pid?: number;
  port: number;
  provider?: { name: string; sessionId: string };
  daemonSocketPath?: string;
};

function waitForCloseSignalWindow(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readProviderReplayUrl(session: string, logger: LoggerApi): string | undefined {
  const closePath = getSessionProviderClosePath(session);
  if (!existsSync(closePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(closePath, "utf8")) as {
      replayUrl?: unknown;
    };
    return typeof parsed.replayUrl === "string" && parsed.replayUrl.length > 0
      ? parsed.replayUrl
      : undefined;
  } catch (err) {
    logger.warn("provider-close-result-read-failed", {
      session,
      path: closePath,
      error: err,
    });
    return undefined;
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

function formatSessionList(
  targets: ReadonlyArray<{ session: string }>,
): string {
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
      provider: state.provider,
      daemonSocketPath: state.daemonSocketPath,
    });
  }

  return { closable, clearedUnreadableStates };
}

function unlinkDaemonSocket(
  socketPath: string | undefined,
  logger: LoggerApi,
  session: string,
): void {
  if (!socketPath) return;
  try {
    unlinkSync(socketPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn("close-socket-unlink-failed", {
        session,
        socketPath,
        error: err,
      });
    }
  }
}

function clearStoppedSessionStates(
  sessions: ReadonlyArray<ClosableSession>,
  logger: LoggerApi,
  skip?: ReadonlySet<string>,
): number {
  let cleared = 0;
  for (const session of sessions) {
    if (skip?.has(session.session)) continue;
    if (session.pid == null || !isPidRunning(session.pid)) {
      unlinkDaemonSocket(session.daemonSocketPath, logger, session.session);
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

  // Provider sessions are owned by their daemons. Send SIGTERM below and let
  // each daemon close its remote provider session during shutdown.
  const failedProviderSessions = new Set<string>();

  // Send SIGTERM to all daemon processes (both local and provider sessions).
  for (const target of closable) {
    if (target.pid == null) continue;
    logger.info("close-all-sigterm", {
      session: target.session,
      pid: target.pid,
      port: target.port,
    });
    sendSignalToProcessGroupOrPid(
      target.pid,
      "SIGTERM",
      logger,
      target.session,
    );
  }

  await waitForCloseSignalWindow(CLOSE_WAIT_MS);

  let survivors = closable.filter(
    (target) => target.pid != null && isPidRunning(target.pid),
  );
  if (survivors.length > 0 && !force) {
    const closed = clearStoppedSessionStates(
      closable,
      logger,
      failedProviderSessions,
    );

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
      if (survivor.pid != null) {
        sendSignalToProcessGroupOrPid(
          survivor.pid,
          "SIGKILL",
          logger,
          survivor.session,
        );
      }
      forceKilled += 1;
    }
    await waitForCloseSignalWindow(FORCE_CLOSE_WAIT_MS);
    survivors = survivors.filter(
      (target) => target.pid != null && isPidRunning(target.pid),
    );
    if (survivors.length > 0) {
      const closed = clearStoppedSessionStates(
        closable,
        logger,
        failedProviderSessions,
      );
      throw new Error(
        [
          `Failed to force-close ${survivors.length} session(s): ${formatSessionList(survivors)}.`,
          `Closed ${closed} session(s).`,
        ].join("\n"),
      );
    }
  }

  const replayUrls = closable
    .filter((target) => target.provider)
    .flatMap((target) => {
      const replayUrl = readProviderReplayUrl(target.session, logger);
      return replayUrl ? [{ session: target.session, replayUrl }] : [];
    });

  clearStoppedSessionStates(closable, logger, failedProviderSessions);

  if (clearedUnreadableStates > 0) {
    console.log(
      `Cleared ${clearedUnreadableStates} unreadable session state file(s).`,
    );
  }
  const closedCount = closable.length - failedProviderSessions.size;
  console.log(`Closed ${closedCount} session(s).`);
  for (const recording of replayUrls) {
    console.log(
      `View recording for session "${recording.session}": ${recording.replayUrl}`,
    );
  }
  if (forceKilled > 0) {
    console.log(`Force-killed ${forceKilled} session(s).`);
  }
}

export async function runConnect(
  cdpUrl: string,
  session: string,
  logger: LoggerApi,
  accessMode: SessionAccessMode = "write-access",
): Promise<void> {
  logger.info("connect-start", { cdpUrl, session, accessMode });
  assertSessionAvailableForStart(session, logger);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cdpUrl);
  } catch {
    throw new Error(
      [
        `Invalid CDP URL: ${cdpUrl}`,
        ``,
        `Expected an HTTP or WebSocket URL pointing to a Chrome DevTools Protocol endpoint, for example:`,
        `  libretto connect http://127.0.0.1:9222`,
        `  libretto connect http://remote-host:9222`,
        `  libretto connect http://remote-host:9222/devtools/browser/<id>`,
        `  libretto connect ws://remote-host:9222/devtools/browser/<id>`,
        `  libretto connect wss://remote-host/cdp-endpoint`,
      ].join("\n"),
    );
  }

  const endpoint = parsedUrl.href;
  const isWebSocket =
    parsedUrl.protocol === "ws:" || parsedUrl.protocol === "wss:";
  const port = parsedUrl.port
    ? Number(parsedUrl.port)
    : parsedUrl.protocol === "https:" || parsedUrl.protocol === "wss:"
      ? 443
      : 80;

  console.log(
    `Connecting to CDP endpoint at ${endpoint} (session: ${session})...`,
  );

  // Fast-fail: verify the CDP endpoint is reachable before spawning
  // the daemon (HTTP only — WebSocket endpoints are validated by the
  // daemon's connectOverCDP call).
  if (!isWebSocket) {
    const versionUrl = `${parsedUrl.protocol}//${parsedUrl.host}/json/version`;
    try {
      const resp = await fetch(versionUrl);
      const versionInfo = await resp.json();
      logger.info("connect-version-ok", { versionUrl, versionInfo });
    } catch (err) {
      logger.error("connect-version-failed", { versionUrl, error: err });
      throw new Error(
        `Cannot reach CDP endpoint at ${versionUrl}. Make sure the target is running and accessible at ${parsedUrl.host}.`,
      );
    }
  } else {
    logger.info("connect-skip-version-check", {
      reason: "WebSocket-only endpoint, skipping HTTP version check",
      endpoint,
    });
  }

  const runLogPath = logFileForSession(session);
  const { pid, socketPath: daemonSocketPath, client } =
    await DaemonClient.spawn({
      config: {
        session,
        browser: { kind: "connect", cdpEndpoint: endpoint },
      },
      logger,
      logPath: runLogPath,
      startupTimeoutMs: 10_000,
    });

  writeSessionState(
    {
      port,
      pid,
      cdpEndpoint: endpoint,
      session,
      startedAt: new Date().toISOString(),
      status: "active",
      mode: accessMode,
      daemonSocketPath,
    },
    logger,
  );

  // Query the daemon for discovered pages.
  const pages = await client.pages();

  logger.info("connect-success", { cdpUrl: endpoint, session, port });
  console.log(`Connected to ${endpoint} (session: ${session})`);
  console.log(`  Pages found: ${pages.length}`);
  if (pages.length > 0) {
    for (const p of pages.slice(0, 5)) {
      console.log(`    ${p.url}`);
    }
    if (pages.length > 5) {
      console.log(`    ... and ${pages.length - 5} more`);
    }
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
