import type { Browser, BrowserContext, Page } from "playwright";

export type WindowPosition = { x: number; y: number };

export async function applyWindowPosition(
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

  let pageCdp:
    | Awaited<ReturnType<BrowserContext["newCDPSession"]>>
    | undefined;
  let browserCdp:
    | Awaited<ReturnType<Browser["newBrowserCDPSession"]>>
    | undefined;
  try {
    pageCdp = await context.newCDPSession(page);
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
    await pageCdp?.detach().catch(() => {});
    await browserCdp?.detach().catch(() => {});
  }
}
