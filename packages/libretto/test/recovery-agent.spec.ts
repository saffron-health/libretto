import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateObject } from "ai";
import { executeRecoveryAgent } from "../src/index.js";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

function pngWithDimensions(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe("executeRecoveryAgent", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(generateObject).mockReset();
  });

  it("scales screenshot pixel coordinates into viewport coordinates", async () => {
    vi.useFakeTimers();
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: {
          reasoning: "Click the close button",
          action: {
            type: "click",
            x: 250,
            y: 125,
            text: null,
            keys: null,
            scroll_x: null,
            scroll_y: null,
          },
        },
      } as never)
      .mockResolvedValueOnce({
        object: {
          reasoning: "The popup is gone",
          action: {
            type: "done",
            x: null,
            y: null,
            text: null,
            keys: null,
            scroll_x: null,
            scroll_y: null,
          },
        },
      } as never);

    const click = vi.fn(async () => undefined);
    const screenshot = vi
      .fn<() => Promise<Buffer>>()
      .mockResolvedValue(pngWithDimensions(500, 250));
    const page = {
      viewportSize: vi.fn(() => ({ width: 1000, height: 500 })),
      screenshot,
      mouse: {
        click,
      },
    } as unknown as Page;

    const resultPromise = executeRecoveryAgent(
      page,
      "Close the popup",
      undefined,
      {} as never,
    );
    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(screenshot).toHaveBeenCalledWith({
      fullPage: false,
      scale: "css",
      timeout: 10000,
    });
    expect(click).toHaveBeenCalledWith(500, 250, { button: "left" });
    expect(result.status).toBe("action-taken");
    expect(result.steps).toHaveLength(2);
  });

  it("uses page viewport metrics when Playwright has no viewport", async () => {
    vi.useFakeTimers();
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: {
          reasoning: "Click the close button",
          action: {
            type: "click",
            x: 250,
            y: 125,
            text: null,
            keys: null,
            scroll_x: null,
            scroll_y: null,
          },
        },
      } as never)
      .mockResolvedValueOnce({
        object: {
          reasoning: "The popup is gone",
          action: {
            type: "done",
            x: null,
            y: null,
            text: null,
            keys: null,
            scroll_x: null,
            scroll_y: null,
          },
        },
      } as never);

    const click = vi.fn(async () => undefined);
    const screenshot = vi
      .fn<() => Promise<Buffer>>()
      .mockResolvedValue(pngWithDimensions(500, 250));
    const evaluate = vi.fn(async () => ({
      visualViewportWidth: 1000,
      visualViewportHeight: 500,
    }));
    const page = {
      viewportSize: vi.fn(() => null),
      evaluate,
      screenshot,
      mouse: {
        click,
      },
    } as unknown as Page;

    const resultPromise = executeRecoveryAgent(
      page,
      "Close the popup",
      undefined,
      {} as never,
    );
    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(evaluate).toHaveBeenCalled();
    expect(screenshot).toHaveBeenCalledWith({
      fullPage: false,
      scale: "css",
      timeout: 10000,
    });
    expect(click).toHaveBeenCalledWith(500, 250, { button: "left" });
    expect(result.status).toBe("action-taken");
    expect(result.steps).toHaveLength(2);
  });

  it("uses CDP screenshot metrics when page viewport metrics are unavailable", async () => {
    vi.useFakeTimers();
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: {
          reasoning: "Click the close button",
          action: {
            type: "click",
            x: 250,
            y: 125,
            text: null,
            keys: null,
            scroll_x: null,
            scroll_y: null,
          },
        },
      } as never)
      .mockResolvedValueOnce({
        object: {
          reasoning: "The popup is gone",
          action: {
            type: "done",
            x: null,
            y: null,
            text: null,
            keys: null,
            scroll_x: null,
            scroll_y: null,
          },
        },
      } as never);

    const click = vi.fn(async () => undefined);
    const screenshot = vi.fn<() => Promise<Buffer>>();
    const evaluate = vi.fn(async () => {
      throw new Error("execution context unavailable");
    });
    const detach = vi.fn(async () => undefined);
    const send = vi.fn(async (method: string) => {
      if (method === "Page.getLayoutMetrics") {
        return {
          cssVisualViewport: {
            clientWidth: 1000,
            clientHeight: 500,
          },
        };
      }
      if (method === "Page.captureScreenshot") {
        return {
          data: pngWithDimensions(500, 250).toString("base64"),
        };
      }
      return {};
    });
    const page = {
      viewportSize: vi.fn(() => null),
      evaluate,
      screenshot,
      context: vi.fn(() => ({
        newCDPSession: vi.fn(async () => ({ detach, send })),
      })),
      mouse: {
        click,
      },
    } as unknown as Page;

    const resultPromise = executeRecoveryAgent(
      page,
      "Close the popup",
      undefined,
      {} as never,
    );
    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(evaluate).toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("Page.enable");
    expect(send).toHaveBeenCalledWith("Page.getLayoutMetrics");
    expect(send).toHaveBeenCalledWith("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    expect(detach).toHaveBeenCalled();
    expect(click).toHaveBeenCalledWith(500, 250, { button: "left" });
    expect(result.status).toBe("action-taken");
    expect(result.steps).toHaveLength(2);
  });
});
