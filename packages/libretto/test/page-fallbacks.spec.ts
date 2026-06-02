import { chromium, type Locator, type Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  createFallbackPage,
  popupRecoveryFallback,
  workflow,
} from "../src/index.js";

describe("createFallbackPage", () => {
  it("runs fallback for locator read methods and retries once", async () => {
    const originalError = new Error("covered by popup");
    const textContent = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce("ready");
    const locator = { textContent } as unknown as Locator;
    const page = {
      locator: vi.fn(() => locator),
    } as unknown as Page;
    const fallback = vi.fn(async () => ({ status: "action-taken" }));

    const fallbackPage = createFallbackPage(page, {
      fallback,
    });

    await expect(fallbackPage.locator("#status").textContent()).resolves.toBe(
      "ready",
    );
    expect(textContent).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("runs fallback for page read methods", async () => {
    const title = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("blocked"))
      .mockResolvedValueOnce("Dashboard");
    const page = { title } as unknown as Page;
    const fallback = vi.fn(async () => undefined);

    const fallbackPage = createFallbackPage(page, {
      fallback,
    });

    await expect(fallbackPage.title()).resolves.toBe("Dashboard");
    expect(title).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("preserves synchronous page method return values", () => {
    const page = {
      url: vi.fn(() => "https://example.com/"),
      viewportSize: vi.fn(() => ({ width: 1280, height: 720 })),
      pageErrors: vi.fn(() => []),
    } as unknown as Page;
    const fallback = vi.fn(async () => undefined);

    const fallbackPage = createFallbackPage(page, {
      fallback,
    });

    expect(fallbackPage.url()).toBe("https://example.com/");
    expect(fallbackPage.viewportSize()).toEqual({ width: 1280, height: 720 });
    expect(fallbackPage.pageErrors()).toEqual([]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("does not wrap unsupported arbitrary execution methods", async () => {
    const originalError = new Error("evaluate failed");
    const evaluate = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValue(originalError);
    const page = { evaluate } as unknown as Page;
    const fallback = vi.fn(async () => undefined);

    const fallbackPage = createFallbackPage(page, {
      fallback,
    });

    await expect(fallbackPage.evaluate("1 + 1")).rejects.toBe(originalError);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("preserves the original action error when retry fails", async () => {
    const originalError = new Error("first failure");
    const retryError = new Error("retry failure");
    const click = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(originalError)
      .mockRejectedValueOnce(retryError);
    const locator = { click } as unknown as Locator;
    const page = { locator: vi.fn(() => locator) } as unknown as Page;
    const fallback = vi.fn(async () => undefined);

    const fallbackPage = createFallbackPage(page, {
      fallback,
    });

    await expect(fallbackPage.locator("#submit").click()).rejects.toBe(
      originalError,
    );
    expect(click).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("allows custom fallback logic to compose multiple recovery actions", async () => {
    const originalError = new Error("stale page");
    const click = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce(undefined);
    const locator = { click } as unknown as Locator;
    const page = {
      locator: vi.fn(() => locator),
      reload: vi.fn(async () => undefined),
    } as unknown as Page;
    const closePopup = vi.fn(async (_page: Page) => undefined);
    const fallback = vi.fn(async (context) => {
      await closePopup(context.page);
      await context.page.reload();
    });

    const fallbackPage = createFallbackPage(page, {
      fallback,
    });

    await expect(fallbackPage.locator("#submit").click()).resolves.toBe(
      undefined,
    );
    expect(closePopup).toHaveBeenCalledTimes(1);
    expect(page.reload).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(2);
  });
});

describe("workflow page fallbacks", () => {
  it("injects a single fallback-enabled page into the workflow", async () => {
    const originalError = new Error("popup");
    const textContent = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce("done");
    const locator = { textContent } as unknown as Locator;
    const rawPage = {
      locator: vi.fn(() => locator),
    } as unknown as Page;
    const fallback = vi.fn(async () => undefined);

    const wf = workflow("fallback-workflow", {
      pageFallback: fallback,
      handler: async ({ page }) => {
        return await page.locator("#result").textContent();
      },
    });

    await expect(wf.run({ session: "test", page: rawPage }, {})).resolves.toBe(
      "done",
    );
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(textContent).toHaveBeenCalledTimes(2);
  });
});

it.runIf(process.env.LIBRETTO_REAL_POPUP_FALLBACK_TEST === "1")(
  "closes a real popup with the configured model provider",
  async () => {
    const provider = process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai";
    const apiKey =
      provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Set OPENAI_API_KEY or ANTHROPIC_API_KEY for the real popup fallback test.",
      );
    }

    const model =
      process.env.LIBRETTO_REAL_POPUP_FALLBACK_MODEL ??
      (provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4.1-mini");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <style>
          #modal {
            position: fixed;
            inset: 0;
            z-index: 10;
            background: rgba(0, 0, 0, 0.5);
            display: grid;
            place-items: center;
          }
          #dialog {
            background: white;
            color: black;
            padding: 24px;
            width: 320px;
            font-family: sans-serif;
          }
          #close {
            display: block;
            width: 260px;
            height: 96px;
            margin: 20px auto 0;
            font-size: 22px;
          }
        </style>
        <button id="target">Read result</button>
        <div id="modal">
          <div id="dialog">
            <h1>Cookie preferences</h1>
            <p>This popup blocks the page. Close it to continue.</p>
            <button id="close" onclick="document.querySelector('#modal').remove()">Close popup</button>
          </div>
        </div>
        <script>
          document.querySelector("#target").addEventListener("click", () => {
            document.body.dataset.clicked = "true";
          });
        </script>
      `);

      const fallbackPage = createFallbackPage(page, {
        fallback: popupRecoveryFallback({
          provider,
          apiKey,
          model,
          maxSteps: 3,
        }),
      });
      fallbackPage.setDefaultTimeout(500);

      try {
        await fallbackPage.locator("#target").click();
      } catch (error) {
        throw new Error(
          error instanceof Error ? error.message : String(error),
        );
      }

      expect(await page.locator("#modal").count()).toBe(0);
      expect(await page.locator("body").getAttribute("data-clicked")).toBe(
        "true",
      );
    } finally {
      await browser.close();
    }
  },
  60_000,
);
