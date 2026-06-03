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
});
