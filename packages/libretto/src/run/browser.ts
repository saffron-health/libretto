import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer } from "node:net";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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

export async function launchBrowser({
  sessionName,
  headless = false,
  viewport = { width: 1366, height: 768 },
  storageStatePath,
}: LaunchBrowserArgs): Promise<BrowserSession> {
  const debugPort = await pickFreePort();
  const browser = await chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      `--remote-debugging-port=${debugPort}`,
      "--no-focus-on-check",
    ],
  });

  const context = await browser.newContext({
    viewport,
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(45_000);

  const metadataPath = join(process.cwd(), "tmp", "libretto", `${sessionName}.json`);
  mkdirSync(dirname(metadataPath), { recursive: true });
  writeFileSync(
    metadataPath,
    JSON.stringify({ session: sessionName, port: debugPort, startedAt: new Date().toISOString() }, null, 2),
  );

  return {
    browser,
    context,
    page,
    debugPort,
    metadataPath,
    close: async () => {
      await browser.close();
      if (existsSync(metadataPath)) {
        try { unlinkSync(metadataPath); } catch {}
      }
    },
  };
}
