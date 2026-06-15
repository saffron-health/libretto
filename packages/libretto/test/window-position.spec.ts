import { describe, expect, it, vi } from "vitest";
import { applyWindowPosition } from "../src/shared/run/window-position.js";

describe("applyWindowPosition", () => {
  it("does nothing when no window position is configured", async () => {
    const newCDPSession = vi.fn();

    await applyWindowPosition(
      {} as never,
      { newCDPSession } as never,
      {} as never,
      undefined,
    );

    expect(newCDPSession).not.toHaveBeenCalled();
  });

  it("sets browser window bounds for the target page", async () => {
    const pageCdp = {
      send: vi.fn(async (method: string) => {
        expect(method).toBe("Target.getTargetInfo");
        return { targetInfo: { targetId: "target-1" } };
      }),
      detach: vi.fn(async () => {}),
    };
    const browserCdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Browser.getWindowForTarget") {
          return { windowId: 123 };
        }
        return {};
      }),
      detach: vi.fn(async () => {}),
    };
    const browser = {
      newBrowserCDPSession: vi.fn(async () => browserCdp),
    };
    const context = {
      newCDPSession: vi.fn(async () => pageCdp),
    };
    const page = {};

    await applyWindowPosition(
      browser as never,
      context as never,
      page as never,
      { x: 536, y: 33 },
    );

    expect(context.newCDPSession).toHaveBeenCalledWith(page);
    expect(browser.newBrowserCDPSession).toHaveBeenCalled();
    expect(browserCdp.send).toHaveBeenCalledWith("Browser.getWindowForTarget", {
      targetId: "target-1",
    });
    expect(browserCdp.send).toHaveBeenCalledWith("Browser.setWindowBounds", {
      windowId: 123,
      bounds: {
        left: 536,
        top: 33,
        windowState: "normal",
      },
    });
    expect(pageCdp.detach).toHaveBeenCalled();
    expect(browserCdp.detach).toHaveBeenCalled();
  });

  it("does not throw when positioning fails", async () => {
    const pageCdp = {
      send: vi.fn(async () => {
        throw new Error("cdp failed");
      }),
      detach: vi.fn(async () => {}),
    };
    const context = {
      newCDPSession: vi.fn(async () => pageCdp),
    };

    await expect(
      applyWindowPosition(
        { newBrowserCDPSession: vi.fn() } as never,
        context as never,
        {} as never,
        { x: 10, y: 20 },
      ),
    ).resolves.toBeUndefined();
    expect(pageCdp.detach).toHaveBeenCalled();
  });
});
