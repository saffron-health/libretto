import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright";
import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { isWindowsNamedPipePath } from "../../shared/ipc/socket-transport.js";
import type { LoggerApi } from "../../shared/logger/index.js";
import type { SessionAccessMode } from "../../shared/state/index.js";
import type { Experiments } from "./experiments.js";
import { getSessionProviderClosePath } from "./context.js";
import { readLibrettoConfig } from "./config.js";
import {
  captureAuthProfileStorageState,
  parseAuthProfileSites,
} from "../../shared/workflow/auth-profile-state.js";
import {
  formatMissingLocalAuthProfileMessage,
  getProfilePath,
  hasProfile,
  normalizeProfileName,
  writeProfile,
} from "./profiles.js";
import {
  getCloudProviderApi,
  getProviderStartupTimeoutMs,
} from "./providers/index.js";
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
import { DaemonClient } from "./daemon/ipc.js";

const CLOSE_WAIT_MS = 1_500;
const PROVIDER_CLOSE_WAIT_MS = 30_000;
const FORCE_CLOSE_WAIT_MS = 300;

type CloseResult = { replayUrl?: string };

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
    parsedUrl.protocol === "file:" ||
    parsedUrl.href === "about:blank"
  ) {
    return parsedUrl;
  }

  if (isLikelyHostWithPort(parsedUrl, url)) {
    return new URL(`https://${url}`);
  }

  throw new Error(
    `Unsupported URL protocol: ${parsedUrl.protocol}. Use http://, https://, file://, or about:blank.`,
  );
}

export function normalizeDomain(url: URL): string {
  return url.hostname.replace(/^www\./, "");
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
  const client = await DaemonClient.connect(state.daemonSocketPath);
  try {
    pageSummaries = await client.pages();
  } finally {
    client.destroy();
  }

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
  options: {
    viewport?: { width: number; height: number };
    accessMode?: SessionAccessMode;
    authProfileName?: string;
    experiments: Experiments;
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

  // When --auth-profile is provided, use that named profile instead of
  // deriving a legacy domain profile from the URL.
  const authProfileName = options?.authProfileName
    ? normalizeProfileName(options.authProfileName)
    : undefined;
  if (authProfileName) {
    const authProfilePath = getProfilePath(authProfileName);
    if (!hasProfile(authProfileName)) {
      throw new Error(
        formatMissingLocalAuthProfileMessage({
          profileName: authProfileName,
          profilePath: authProfilePath,
          session,
        }),
      );
    }
  }

  const supportsSavedProfile =
    parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  const profileName =
    authProfileName ?? (supportsSavedProfile ? normalizeDomain(parsedUrl) : undefined);
  const profilePath = profileName ? getProfilePath(profileName) : undefined;
  const useProfile = profileName ? hasProfile(profileName) : false;

  logger.info("open-launching", {
    url,
    mode: browserMode,
    session,
    port,
    profileName,
    useProfile,
    profilePath: useProfile ? profilePath : undefined,
  });

  if (useProfile) {
    console.log(`Loading saved profile ${profileName}`);
  }
  console.log(`Launching ${browserMode} browser (session: ${session})...`);

  // Spawn daemon and wait for IPC readiness. The daemon launches
  // Chromium internally — IPC readiness implies the browser is up,
  // so no separate CDP polling is needed.
  const { pid, socketPath: daemonSocketPath, client } =
    await DaemonClient.spawn({
      config: {
        session,
        experiments: options.experiments,
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
  client.destroy();

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
  accessMode: SessionAccessMode,
  experiments: Experiments,
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
    client,
  } = await DaemonClient.spawn({
    config: {
      session,
      experiments,
      browser: {
        kind: "provider",
        providerName,
        initialUrl: url,
      },
    },
    logger,
    logPath: runLogPath,
    // Remote provider creation can wait for cloud capacity before CDP exists.
    startupTimeoutMs: getProviderStartupTimeoutMs(providerName),
  });
  client.destroy();

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
    recordingUrl: providerSession.recordingUrl,
  });

  if (providerSession.liveViewUrl) {
    console.log(`View live session: ${providerSession.liveViewUrl}`);
  }
  if (providerSession.recordingUrl) {
    console.log(`View recording: ${providerSession.recordingUrl}`);
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
        recordingUrl: providerSession.recordingUrl,
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
  profileName: string,
  session: string,
  logger: LoggerApi,
  options: { sites: string } = { sites: "" },
): Promise<void> {
  const normalizedProfileName = normalizeProfileName(profileName);
  const sites = parseAuthProfileSites(options.sites);
  if (sites.length === 0) {
    throw new Error("Pass at least one site with --sites <site[,site]>.");
  }

  logger.info("save-start", { profileName: normalizedProfileName, session, sites });
  const { browser, context } = await connect(session, logger);

  try {
    const state = await captureAuthProfileStorageState(context, sites);
    const profilePath = await writeProfile(normalizedProfileName, state);

    logger.info("save-success", {
      profileName: normalizedProfileName,
      sites,
      profilePath,
      cookieCount: state.cookies?.length ?? 0,
      originCount: state.origins?.length ?? 0,
    });
    console.log(`Profile saved: ${normalizedProfileName}`);
    console.log(`   Location: ${profilePath}`);
    console.log(`   Sites: ${sites.join(", ")}`);
    console.log(
      `   Cookies: ${state.cookies?.length ?? 0}, Origins: ${state.origins?.length ?? 0}`,
    );
  } catch (err) {
    logger.error("save-error", { error: err, profileName, session, sites });
    throw err;
  } finally {
    disconnectBrowser(browser, logger, session);
  }
}

export async function runFetchChromeProfile(
  profileName: string,
  cdpUrl: string,
  logger: LoggerApi,
  options: { sites: string },
): Promise<void> {
  const normalizedProfileName = normalizeProfileName(profileName);
  const sites = parseAuthProfileSites(options.sites);
  if (sites.length === 0) {
    throw new Error("Pass at least one site with --sites <site[,site]>.");
  }

  logger.info("fetch-chrome-profile-start", {
    profileName: normalizedProfileName,
    cdpUrl,
    sites,
  });
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error("Connected Chrome instance has no browser context.");
    }
    const state = await captureAuthProfileStorageState(context, sites);
    const profilePath = await writeProfile(normalizedProfileName, state);
    console.log(`Profile fetched: ${normalizedProfileName}`);
    console.log(`   Location: ${profilePath}`);
    console.log(`   Sites: ${sites.join(", ")}`);
    console.log(
      `   Cookies: ${state.cookies?.length ?? 0}, Origins: ${state.origins?.length ?? 0}`,
    );
  } finally {
    disconnectBrowser(browser, logger);
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

  let replayUrl: string | undefined;
  if (state.daemonSocketPath && state.pid != null && isPidRunning(state.pid)) {
    try {
      const result = await closeDaemonSession(
        {
          session,
          pid: state.pid,
          port: state.port,
          provider: state.provider,
          daemonSocketPath: state.daemonSocketPath,
        },
        logger,
      );
      replayUrl = result.replayUrl;
      if (!state.provider) {
        await waitForCloseSignalWindow(CLOSE_WAIT_MS);
      }
    } catch (error) {
      if (state.provider) {
        writeSessionState({ ...state, status: "cleanup-failed" }, logger);
      }
      throw formatDaemonCloseFailure(session, state.provider?.name, error);
    }
  } else if (state.pid != null) {
    logger.info("close-killing", { session, pid: state.pid, port: state.port });
    sendSignalToProcessGroupOrPid(state.pid, "SIGTERM", logger, session);
    if (state.provider) {
      await waitForProviderCloseResult(session, state.pid);
    } else {
      await waitForCloseSignalWindow(CLOSE_WAIT_MS);
    }
  }

  if (state.provider) {
    logger.info("close-provider-daemon-owned", {
      session,
      provider: state.provider.name,
      sessionId: state.provider.sessionId,
    });
    if (!hasProviderCloseResult(session)) {
      if (state.pid == null || !isPidRunning(state.pid)) {
        try {
          replayUrl = await closeProviderSessionDirectly(session, state.provider, logger);
        } catch (error) {
          writeSessionState({ ...state, status: "cleanup-failed" }, logger);
          throw error;
        }
      } else {
        writeSessionState({ ...state, status: "cleanup-failed" }, logger);
        throw new Error(
          `Failed to confirm remote ${state.provider.name} session cleanup for session "${session}". ` +
            `State preserved with status "cleanup-failed". Retry with: libretto close --session ${session}`,
        );
      }
    } else {
      replayUrl = replayUrl ?? readProviderReplayUrl(session, logger);
    }
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

async function closeDaemonSession(
  target: ClosableSession,
  logger: LoggerApi,
): Promise<CloseResult> {
  if (!target.daemonSocketPath) {
    throw new Error("session has no daemon socket path");
  }

  const timeoutMs = target.provider ? PROVIDER_CLOSE_WAIT_MS : CLOSE_WAIT_MS;
  logger.info("close-daemon-ipc-start", {
    session: target.session,
    pid: target.pid,
    provider: target.provider?.name,
    timeoutMs,
  });

  let client: DaemonClient | undefined;
  try {
    client = await DaemonClient.connect(target.daemonSocketPath);
    const result = await withTimeout(
      client.close(),
      timeoutMs,
      `Daemon did not respond to close within ${timeoutMs}ms.`,
    );
    logger.info("close-daemon-ipc-success", {
      session: target.session,
      replayUrl: result.replayUrl,
    });
    return result;
  } finally {
    client?.destroy();
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function formatDaemonCloseFailure(
  session: string,
  providerName: string | undefined,
  error: unknown,
): Error {
  const message = error instanceof Error ? error.message : String(error);
  const cleanupWarning = providerName
    ? ` State preserved with status "cleanup-failed" because remote ${providerName} cleanup could not be confirmed.`
    : " State preserved so you can retry or inspect the session.";
  return new Error(
    `Failed to close session "${session}" gracefully over daemon IPC: ${message}.${cleanupWarning} Retry with: libretto close --session ${session}`,
  );
}

function waitForCloseSignalWindow(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForProviderCloseResult(
  session: string,
  pid: number,
): Promise<void> {
  const deadline = Date.now() + PROVIDER_CLOSE_WAIT_MS;
  while (Date.now() < deadline) {
    if (hasProviderCloseResult(session) || !isPidRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForCloseAllTargets(
  targets: ReadonlyArray<ClosableSession>,
): Promise<void> {
  const hasProviderSession = targets.some((target) => target.provider);
  const deadline =
    Date.now() + (hasProviderSession ? PROVIDER_CLOSE_WAIT_MS : CLOSE_WAIT_MS);
  while (Date.now() < deadline) {
    const stillWaiting = targets.some((target) => {
      if (target.pid == null || !isPidRunning(target.pid)) return false;
      return target.provider ? !hasProviderCloseResult(target.session) : true;
    });
    if (!stillWaiting) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function closeProviderSessionDirectly(
  session: string,
  providerState: { name: string; sessionId: string; recordingUrl?: string },
  logger: LoggerApi,
): Promise<string | undefined> {
  try {
    const provider = getCloudProviderApi(providerState.name);
    const result = await provider.closeSession(providerState.sessionId);
    logger.info("close-provider-direct-fallback-success", {
      session,
      provider: providerState.name,
      sessionId: providerState.sessionId,
      replayUrl: result.replayUrl,
    });
    return result.replayUrl ?? providerState.recordingUrl;
  } catch (error) {
    logger.warn("close-provider-direct-fallback-failed", {
      session,
      provider: providerState.name,
      sessionId: providerState.sessionId,
      error,
    });
    throw new Error(
      `Failed to close remote ${providerState.name} session "${providerState.sessionId}" for session "${session}". ` +
        `State preserved with status "cleanup-failed". Retry with: libretto close --session ${session}`,
    );
  }
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

function hasProviderCloseResult(session: string): boolean {
  return existsSync(getSessionProviderClosePath(session));
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
  if (isWindowsNamedPipePath(socketPath)) return;

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

function markProviderCleanupFailed(session: string, logger: LoggerApi): void {
  const state = readSessionState(session, logger);
  if (!state) return;
  writeSessionState({ ...state, status: "cleanup-failed" }, logger);
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

  const failedProviderSessions = new Set<string>();
  const gracefulCloseFailures = new Map<string, Error>();

  await Promise.all(
    closable.map(async (target) => {
      if (target.pid == null) return;
      if (target.daemonSocketPath && isPidRunning(target.pid)) {
        try {
          await closeDaemonSession(target, logger);
          return;
        } catch (error) {
          const closeError = formatDaemonCloseFailure(
            target.session,
            target.provider?.name,
            error,
          );
          gracefulCloseFailures.set(target.session, closeError);
          logger.warn("close-all-daemon-ipc-failed", {
            session: target.session,
            pid: target.pid,
            error: closeError.message,
          });
          if (!force) return;
        }
      }

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
    }),
  );

  await waitForCloseAllTargets(closable);

  for (const target of closable) {
    if (!target.provider || hasProviderCloseResult(target.session)) continue;
    if (target.pid != null && isPidRunning(target.pid)) continue;
    try {
      await closeProviderSessionDirectly(target.session, target.provider, logger);
    } catch {
      markProviderCleanupFailed(target.session, logger);
      failedProviderSessions.add(target.session);
    }
  }

  let survivors = closable.filter(
    (target) => target.pid != null && isPidRunning(target.pid),
  );
  if ((survivors.length > 0 || gracefulCloseFailures.size > 0) && !force) {
    const closed = clearStoppedSessionStates(
      closable,
      logger,
      failedProviderSessions,
    );
    const failedSessions = Array.from(
      new Set([
        ...survivors.map((survivor) => survivor.session),
        ...gracefulCloseFailures.keys(),
      ]),
    ).map((sessionName) => ({ session: sessionName }));

    throw new Error(
      [
        `Failed to close ${failedSessions.length} session(s) gracefully: ${formatSessionList(failedSessions)}.`,
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
  if (failedProviderSessions.size > 0) {
    console.warn(
      `Failed to confirm remote cleanup for ${failedProviderSessions.size} provider-backed session(s). ` +
        `State preserved with status "cleanup-failed". Retry with: libretto close --all`,
    );
  }
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
  accessMode: SessionAccessMode,
  experiments: Experiments,
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
        experiments,
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
  let pages: OpenPageSummary[];
  try {
    pages = await client.pages();
  } finally {
    client.destroy();
  }

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
