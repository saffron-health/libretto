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
  SessionStateFileSchema,
} from "../state/session-state.js";
import { readLibrettoConfig } from "../../cli/core/ai-config.js";

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
};

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  debugPort: number;
  metadataPath: string;
  close: () => Promise<void>;
};

function resolveWindowPosition(): { x: number; y: number } | undefined {
  return readLibrettoConfig().windowPosition;
}

async function applyWindowPosition(
  browser: Browser,
  context: BrowserContext,
  page: Page,
  windowPosition: { x: number; y: number } | undefined,
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
}: LaunchBrowserArgs): Promise<BrowserSession> {
  const debugPort = await pickFreePort();
  const windowPosition = headless ? undefined : resolveWindowPosition();
  const browser = await chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      `--remote-debugging-port=${debugPort}`,
      "--no-focus-on-check",
      ...(windowPosition
        ? [`--window-position=${windowPosition.x},${windowPosition.y}`]
        : []),
    ],
  });

  const context = await browser.newContext({
    viewport,
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
  });
  const page = await context.newPage();
  await applyWindowPosition(browser, context, page, windowPosition);
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
