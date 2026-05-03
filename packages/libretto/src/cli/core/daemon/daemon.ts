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
import { mkdir, writeFile } from "node:fs/promises";
import { appendFileSync, writeFileSync } from "node:fs";
import { installSessionTelemetry } from "../session-telemetry.js";
import type { LibrettoWorkflowContext } from "../../../shared/workflow/workflow.js";
import {
  createLoggerForSession,
  getSessionDir,
  getSessionNetworkLogPath,
  getSessionActionsLogPath,
  getSessionProviderClosePath,
} from "../context.js";
import type { LoggerApi } from "../../../shared/logger/index.js";
import {
  DaemonServer,
  getDaemonSocketPath,
  type DaemonRequest,
} from "./ipc.js";
import { wrapPageForActionLogging } from "../telemetry.js";
import {
  getProfilePath,
  hasProfile,
  normalizeDomain,
  normalizeUrl,
} from "../browser.js";
import { handlePages } from "./pages.js";
import { handleExec, handleReadonlyExec } from "./exec.js";
import { handleSnapshot } from "./snapshot.js";
import { getPauseSignalPaths } from "../pause-signals.js";
import { librettoCommand } from "../package-manager.js";
import {
  type DaemonConfig,
  type DaemonBrowserLaunchConfig,
  type DaemonBrowserConnectConfig,
  type DaemonBrowserProviderConfig,
  type DaemonWorkflowConfig,
} from "./config.js";
import { getCloudProviderApi } from "../providers/index.js";
import type { ProviderApi } from "../providers/types.js";
import {
  getAbsoluteIntegrationPath,
  installHeadedWorkflowVisualization,
  loadDefaultWorkflow,
  type LoadedLibrettoWorkflow,
} from "../workflow-runtime.js";

function isOperationalPage(page: Page): boolean {
  const url = page.url();
  return !url.startsWith("devtools://") && !url.startsWith("chrome-error://");
}

type TelemetryEntry = Record<string, unknown>;

class UserFacingStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingStartupError";
  }
}

function mirrorStdoutToFile(filePath: string): () => void {
  const stdout = process.stdout;
  const originalWrite = stdout.write.bind(stdout);

  stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    try {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk), "utf8");
      appendFileSync(filePath, buffer);
    } catch {
      // Ignore log mirroring failures; primary stdout should still flow.
    }
    return originalWrite(
      chunk as string | Uint8Array,
      ...(args as [BufferEncoding?, ((error?: Error | null) => void)?]),
    );
  }) as typeof stdout.write;

  return () => {
    stdout.write = originalWrite as typeof stdout.write;
  };
}

async function writeWorkflowFailureSignal(args: {
  session: string;
  error: unknown;
  phase: "setup" | "workflow";
}): Promise<void> {
  const signalPaths = getPauseSignalPaths(args.session);
  const errorMessage =
    args.error instanceof Error ? args.error.message : String(args.error);
  await writeFile(
    signalPaths.failedSignalPath,
    JSON.stringify(
      {
        failedAt: new Date().toISOString(),
        message: errorMessage,
        phase: args.phase,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function getMissingLocalAuthProfileError(args: {
  normalizedDomain: string;
  profilePath: string;
  session: string;
}): string {
  return [
    `Local auth profile not found for domain "${args.normalizedDomain}".`,
    `Expected profile file: ${args.profilePath}`,
    "To create it:",
    `  1. libretto open https://${args.normalizedDomain} --headed --session ${args.session}`,
    "  2. Log in manually in the browser window.",
    `  3. libretto save ${args.normalizedDomain} --session ${args.session}`,
  ].join("\n");
}

function resolveAuthProfileStorageStatePath(args: {
  authProfileDomain?: string;
  session: string;
}): string | undefined {
  if (!args.authProfileDomain) return undefined;
  const normalizedDomain = normalizeDomain(
    normalizeUrl(args.authProfileDomain),
  );
  const profilePath = getProfilePath(normalizedDomain);
  if (!hasProfile(normalizedDomain)) {
    throw new UserFacingStartupError(
      getMissingLocalAuthProfileError({
        normalizedDomain,
        profilePath,
        session: args.session,
      }),
    );
  }
  return profilePath;
}

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
    private readonly providerSession?: {
      provider: ProviderApi;
      name: string;
      sessionId: string;
    },
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
    readyProvider?: {
      name: string;
      sessionId: string;
      cdpEndpoint: string;
      liveViewUrl?: string;
    };
    providerSession?: {
      provider: ProviderApi;
      name: string;
      sessionId: string;
    };
  }): Promise<BrowserDaemon> {
    const {
      session,
      externallyManaged,
      browser,
      context,
      page,
      initialPages,
      navigateUrl,
      readyProvider,
      providerSession,
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
      providerSession,
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
    process.send?.({ type: "ready", socketPath, provider: readyProvider });
    daemon.logger.info("ipc-server-listening", { socketPath });

    browser.on("disconnected", () => {
      void daemon.shutdown("browser-disconnected-exiting", false);
    });

    return daemon;
  }

  // ── Launch mode ────────────────────────────────────────────────────

  static async launchBrowser(args: {
    session: string;
    browser: DaemonBrowserLaunchConfig;
    workflow?: DaemonWorkflowConfig;
  }): Promise<BrowserDaemon> {
    const { session, browser: config } = args;
    const windowPositionArg = config.windowPosition
      ? `--window-position=${config.windowPosition.x},${config.windowPosition.y}`
      : undefined;

    const browser = await chromium.launch({
      headless: !config.headed,
      args: [
        "--disable-blink-features=AutomationControlled",
        ...(config.remoteDebuggingPort
          ? [`--remote-debugging-port=${config.remoteDebuggingPort}`]
          : []),
        "--remote-debugging-address=127.0.0.1",
        "--no-focus-on-check",
        ...(windowPositionArg ? [windowPositionArg] : []),
      ],
    });

    const storageStatePath =
      config.storageStatePath ??
      resolveAuthProfileStorageStatePath({
        authProfileDomain: args.workflow?.authProfileDomain,
        session,
      });

    const context = await browser.newContext({
      ...(storageStatePath ? { storageState: storageStatePath } : {}),
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
      session,
      externallyManaged: false,
      browser,
      context,
      page,
      initialPages: [page],
      navigateUrl: config.initialUrl,
    });

    daemon.logger.info("child-launched", {
      port: config.remoteDebuggingPort,
      pid: process.pid,
      session,
    });

    return daemon;
  }

  // ── Connect mode ───────────────────────────────────────────────────

  static async connectToEndpoint(args: {
    session: string;
    browser: DaemonBrowserConnectConfig;
  }): Promise<BrowserDaemon> {
    const { session, browser: config } = args;
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
      session,
      externallyManaged: true,
      browser,
      context,
      page,
      initialPages: operationalPages.length > 0 ? operationalPages : [page],
      navigateUrl: config.initialUrl,
    });

    daemon.logger.info("child-connected", {
      cdpEndpoint: config.cdpEndpoint,
      url: config.initialUrl,
      pid: process.pid,
      session,
    });

    return daemon;
  }

  static async connectToProvider(args: {
    session: string;
    browser: DaemonBrowserProviderConfig;
  }): Promise<BrowserDaemon> {
    const { session, browser: config } = args;
    const provider = getCloudProviderApi(config.providerName);
    const providerSession = await provider.createSession();
    try {
      const browser = await chromium.connectOverCDP(
        providerSession.cdpEndpoint,
      );

      const contexts = browser.contexts();
      const context =
        contexts.length > 0 ? contexts[0] : await browser.newContext();
      const operationalPages = context.pages().filter(isOperationalPage);
      const page =
        operationalPages.length > 0
          ? operationalPages[operationalPages.length - 1]
          : await context.newPage();

      const daemon = await BrowserDaemon.initialize({
        session,
        externallyManaged: true,
        browser,
        context,
        page,
        initialPages: operationalPages.length > 0 ? operationalPages : [page],
        navigateUrl: config.initialUrl,
        readyProvider: {
          name: config.providerName,
          sessionId: providerSession.sessionId,
          cdpEndpoint: providerSession.cdpEndpoint,
          liveViewUrl: providerSession.liveViewUrl,
        },
        providerSession: {
          provider,
          name: config.providerName,
          sessionId: providerSession.sessionId,
        },
      });

      daemon.logger.info("child-provider-connected", {
        provider: config.providerName,
        sessionId: providerSession.sessionId,
        url: config.initialUrl,
        pid: process.pid,
        session,
      });

      return daemon;
    } catch (error) {
      await provider.closeSession(providerSession.sessionId);
      throw error;
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async shutdown(reason: string, closeBrowser: boolean): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.info(reason, { session: this.session });
    await this.ipcServer.close();
    if (closeBrowser) {
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
    if (this.providerSession) {
      const result = await this.providerSession.provider.closeSession(
        this.providerSession.sessionId,
      );
      if (result.replayUrl) {
        this.logger.info("provider-recording", {
          session: this.session,
          provider: this.providerSession.name,
          sessionId: this.providerSession.sessionId,
          replayUrl: result.replayUrl,
        });
      }
      writeFileSync(
        getSessionProviderClosePath(this.session),
        JSON.stringify(
          {
            provider: this.providerSession.name,
            sessionId: this.providerSession.sessionId,
            replayUrl: result.replayUrl,
          },
          null,
          2,
        ),
        "utf8",
      );
    }
  }

  // ── Page resolution ────────────────────────────────────────────────

  private resolveTargetPage(pageId?: string): Page {
    if (!pageId) {
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

  async runWorkflow(args: {
    workflow: DaemonWorkflowConfig;
    headed: boolean;
    loadedWorkflow?: LoadedLibrettoWorkflow;
  }): Promise<void> {
    const signalPaths = getPauseSignalPaths(this.session);
    const restoreStdout = mirrorStdoutToFile(signalPaths.outputSignalPath);
    try {
      const absolutePath = getAbsoluteIntegrationPath(
        args.workflow.integrationPath,
      );
      const workflow = args.loadedWorkflow ?? (await loadDefaultWorkflow(absolutePath));
      const workflowLogger = this.logger.withScope("integration-run", {
        integrationPath: absolutePath,
        workflowName: workflow.name,
        session: this.session,
      });

      console.log(
        `Running workflow "${workflow.name}" from ${absolutePath} (${args.headed ? "headed" : "headless"})...`,
      );

      if (args.headed && args.workflow.visualize !== false) {
        await installHeadedWorkflowVisualization({
          context: this.context,
          logger: workflowLogger,
        });
      }

      // tsx/esbuild can inject __name() wrappers when keepNames is true.
      // Playwright serializes callbacks via Function#toString() into the browser
      // context, which lacks __name, causing ReferenceError without this polyfill.
      await this.context.addInitScript(() => {
        (globalThis as Record<string, unknown>).__name = (
          target: unknown,
          value: string,
        ) =>
          Object.defineProperty(target as object, "name", {
            value,
            configurable: true,
          });
      });

      const workflowContext: LibrettoWorkflowContext = {
        session: this.session,
        page: this.page,
      };

      try {
        await workflow.run(workflowContext, args.workflow.params ?? {});
      } catch (error) {
        await writeWorkflowFailureSignal({
          session: this.session,
          error,
          phase: "workflow",
        });
        return;
      }

      await writeFile(
        signalPaths.completedSignalPath,
        JSON.stringify({ completedAt: new Date().toISOString() }, null, 2),
        "utf8",
      );
    } catch (error) {
      await writeWorkflowFailureSignal({
        session: this.session,
        error,
        phase: "setup",
      });
    } finally {
      restoreStdout();
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = JSON.parse(process.argv[2]) as DaemonConfig;
  const headed =
    config.browser.kind === "launch" ? config.browser.headed : false;

  let loadedWorkflow: LoadedLibrettoWorkflow | undefined;
  if (config.workflow) {
    try {
      loadedWorkflow = await loadDefaultWorkflow(
        getAbsoluteIntegrationPath(config.workflow.integrationPath),
      );
    } catch (error) {
      throw new UserFacingStartupError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const daemon =
    config.browser.kind === "provider"
      ? await BrowserDaemon.connectToProvider({
          session: config.session,
          browser: config.browser,
        })
      : config.browser.kind === "connect"
        ? await BrowserDaemon.connectToEndpoint({
            session: config.session,
            browser: config.browser,
          })
        : await BrowserDaemon.launchBrowser({
            session: config.session,
            browser: config.browser,
            workflow: config.workflow,
          });

  if (config.workflow) {
    void daemon
      .runWorkflow({ workflow: config.workflow, headed, loadedWorkflow })
      .catch((error) => {
        daemon.logger.error("workflow-failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

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

function reportStartupError(error: unknown): never {
  if (error instanceof UserFacingStartupError) {
    process.send?.({
      type: "startup-error",
      message: error.message,
    });
  }
  process.exit(1);
}

try {
  await main();
} catch (error) {
  reportStartupError(error);
}
