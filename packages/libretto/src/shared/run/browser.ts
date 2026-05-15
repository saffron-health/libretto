import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { createServer } from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureLibrettoSessionStatePath } from "../paths/paths.js";
import {
  SESSION_STATE_VERSION,
  type SessionAccessMode,
  SessionStateFileSchema,
} from "../state/session-state.js";

type WindowPosition = { x: number; y: number };

async function pickFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        server.close(() => resolve(addr.port));
        return;
      }
      server.close(() => reject(new Error("Failed to resolve debug port")));
    });
  });
}

export type LaunchBrowserArgs = {
  sessionName: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
  storageStatePath?: string;
  accessMode?: SessionAccessMode;
  cdpEndpoint?: string;
  provider?: { name: string; sessionId: string };
  windowPosition?: WindowPosition;
};

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  debugPort: number;
  metadataPath: string;
  close: () => Promise<void>;
};

async function applyWindowPosition(
  browser: Browser,
  context: BrowserContext,
  page: Page,
  windowPosition: WindowPosition | undefined,
): Promise<void> {
  if (!windowPosition) {
    return;
  }

  const requestedBounds = {
    left: windowPosition.x,
    top: windowPosition.y,
    windowState: "normal" as const,
  };

  const pageCdp = await context.newCDPSession(page);
  let browserCdp:
    | Awaited<ReturnType<Browser["newBrowserCDPSession"]>>
    | undefined;
  try {
    const targetInfo = await pageCdp.send("Target.getTargetInfo");
    const targetId = (
      targetInfo as { targetInfo?: { targetId?: string } }
    ).targetInfo?.targetId;
    browserCdp = await browser.newBrowserCDPSession();
    const windowResult = await browserCdp.send(
      "Browser.getWindowForTarget",
      targetId ? { targetId } : {},
    );
    await browserCdp.send("Browser.setWindowBounds", {
      windowId: windowResult.windowId,
      bounds: requestedBounds,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
  } catch {
    // Best-effort: window positioning should not prevent browser launch.
  } finally {
    await pageCdp.detach().catch(() => {});
    await browserCdp?.detach().catch(() => {});
  }
}

export async function launchBrowser({
  sessionName,
  headless = false,
  viewport = { width: 1366, height: 768 },
  storageStatePath,
  accessMode = "write-access",
  cdpEndpoint,
  provider,
  windowPosition,
}: LaunchBrowserArgs): Promise<BrowserSession> {
  // Cloud/remote mode: connect to an existing CDP endpoint instead of launching locally
  if (cdpEndpoint) {
    const browser = await chromium.connectOverCDP(cdpEndpoint);
    const context =
      browser.contexts()[0] ?? (await browser.newContext({ viewport }));
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(45_000);

    const metadataPath = ensureLibrettoSessionStatePath(sessionName);
    writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          version: SESSION_STATE_VERSION,
          session: sessionName,
          port: 0,
          cdpEndpoint,
          pid: process.pid,
          startedAt: new Date().toISOString(),
          status: "active",
          mode: accessMode,
          ...(provider ? { provider } : {}),
        },
        null,
        2,
      ),
    );

    return {
      browser,
      context,
      page,
      debugPort: 0,
      metadataPath,
      close: async () => {
        await browser.close();
      },
    };
  }

  const debugPort = await pickFreePort();
  const effectiveWindowPosition = headless ? undefined : windowPosition;
  const browser = await chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      `--remote-debugging-port=${debugPort}`,
      "--no-focus-on-check",
      ...(effectiveWindowPosition
        ? [
            `--window-position=${effectiveWindowPosition.x},${effectiveWindowPosition.y}`,
          ]
        : []),
    ],
  });

  const context = await browser.newContext({
    viewport,
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
  });
  const page = await context.newPage();
  await applyWindowPosition(
    browser,
    context,
    page,
    effectiveWindowPosition,
  );
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(45_000);

  const metadataPath = ensureLibrettoSessionStatePath(sessionName);
  const existingStateRaw = existsSync(metadataPath)
    ? (JSON.parse(readFileSync(metadataPath, "utf-8")) as unknown)
    : undefined;

  const parsedExistingState =
    SessionStateFileSchema.safeParse(existingStateRaw);

  writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        version: parsedExistingState.success
          ? parsedExistingState.data.version
          : SESSION_STATE_VERSION,
        session: sessionName,
        port: debugPort,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        status: "active",
        mode: accessMode,
      },
      null,
      2,
    ),
  );

  return {
    browser,
    context,
    page,
    debugPort,
    metadataPath,
    close: async () => {
      await browser.close();
    },
  };
}
