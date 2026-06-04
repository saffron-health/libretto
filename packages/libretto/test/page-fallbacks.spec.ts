import { chromium, type Locator, type Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createRecoveryPage,
  popupRecoveryAction,
  workflow,
} from "../src/index.js";

describe("createRecoveryPage", () => {
  it("runs recovery action for locator read methods and retries once", async () => {
    const originalError = new Error("covered by popup");
    const textContent = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce("ready");
    const locator = { textContent } as unknown as Locator;
    const page = {
      locator: vi.fn(() => locator),
    } as unknown as Page;
    const recoveryAction = vi.fn(async () => ({ status: "action-taken" }));

    const recoveryPage = createRecoveryPage(page, {
      recoveryAction,
    });

    await expect(recoveryPage.locator("#status").textContent()).resolves.toBe(
      "ready",
    );
    expect(textContent).toHaveBeenCalledTimes(2);
    expect(recoveryAction).toHaveBeenCalledTimes(1);
  });

  it("runs recovery action for page read methods", async () => {
    const title = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("blocked"))
      .mockResolvedValueOnce("Dashboard");
    const page = { title } as unknown as Page;
    const recoveryAction = vi.fn(async () => undefined);

    const recoveryPage = createRecoveryPage(page, {
      recoveryAction,
    });

    await expect(recoveryPage.title()).resolves.toBe("Dashboard");
    expect(title).toHaveBeenCalledTimes(2);
    expect(recoveryAction).toHaveBeenCalledTimes(1);
  });

  it("preserves synchronous page method return values", () => {
    const page = {
      url: vi.fn(() => "https://example.com/"),
      viewportSize: vi.fn(() => ({ width: 1280, height: 720 })),
      pageErrors: vi.fn(() => []),
    } as unknown as Page;
    const recoveryAction = vi.fn(async () => undefined);

    const recoveryPage = createRecoveryPage(page, {
      recoveryAction,
    });

    expect(recoveryPage.url()).toBe("https://example.com/");
    expect(recoveryPage.viewportSize()).toEqual({ width: 1280, height: 720 });
    expect(recoveryPage.pageErrors()).toEqual([]);
    expect(recoveryAction).not.toHaveBeenCalled();
  });

  it("does not wrap unsupported arbitrary execution methods", async () => {
    const originalError = new Error("evaluate failed");
    const evaluate = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValue(originalError);
    const page = { evaluate } as unknown as Page;
    const recoveryAction = vi.fn(async () => undefined);

    const recoveryPage = createRecoveryPage(page, {
      recoveryAction,
    });

    await expect(recoveryPage.evaluate("1 + 1")).rejects.toBe(originalError);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(recoveryAction).not.toHaveBeenCalled();
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
    const recoveryAction = vi.fn(async () => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const recoveryPage = createRecoveryPage(page, {
      recoveryAction,
    });

    await expect(recoveryPage.locator("#submit").click()).rejects.toBe(
      originalError,
    );
    expect(click).toHaveBeenCalledTimes(2);
    expect(recoveryAction).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[WARN] Recovered action retry failed",
      expect.objectContaining({
        targetType: "locator",
        method: "click",
        retryError: expect.objectContaining({ message: "retry failure" }),
      }),
    );
    warn.mockRestore();
  });

  it("preserves the original action error when recovery fails", async () => {
    const originalError = new Error("first failure");
    const recoveryError = new Error("recovery failure");
    const click = vi.fn<() => Promise<void>>().mockRejectedValue(originalError);
    const locator = { click } as unknown as Locator;
    const page = { locator: vi.fn(() => locator) } as unknown as Page;
    const recoveryAction = vi.fn(async () => {
      throw recoveryError;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const recoveryPage = createRecoveryPage(page, {
      recoveryAction,
    });

    await expect(recoveryPage.locator("#submit").click()).rejects.toBe(
      originalError,
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(recoveryAction).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[WARN] Recovery action failed",
      expect.objectContaining({
        targetType: "locator",
        method: "click",
        recoveryError: expect.objectContaining({ message: "recovery failure" }),
      }),
    );
    warn.mockRestore();
  });

  it("logs fallback recovery phases", async () => {
    const originalError = new Error("covered by popup");
    const click = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce(undefined);
    const locator = { click } as unknown as Locator;
    const page = { locator: vi.fn(() => locator) } as unknown as Page;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const recoveryAction = vi.fn(async () => ({ status: "action-taken" }));

    const recoveryPage = createRecoveryPage(page, {
      recoveryAction,
    });

    await expect(recoveryPage.locator("#submit").click()).resolves.toBe(
      undefined,
    );
    expect(log).toHaveBeenCalledWith(
      "[INFO] Action failed, attempting recovery",
      expect.objectContaining({ targetType: "locator", method: "click" }),
    );
    expect(log).toHaveBeenCalledWith(
      "[INFO] Recovery action completed, retrying original action",
      expect.objectContaining({
        targetType: "locator",
        method: "click",
        recoveryResult: { status: "action-taken" },
      }),
    );
    expect(log).toHaveBeenCalledWith(
      "[INFO] Recovered action retry succeeded",
      expect.objectContaining({
        targetType: "locator",
        method: "click",
      }),
    );
    expect(warn).not.toHaveBeenCalled();

    log.mockRestore();
    warn.mockRestore();
  });

  it("allows custom recovery logic to compose multiple recovery actions", async () => {
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
    const recoveryAction = vi.fn(async (context) => {
      await closePopup(context.page);
      await context.page.reload();
    });

    const recoveryPage = createRecoveryPage(page, {
      recoveryAction,
    });

    await expect(recoveryPage.locator("#submit").click()).resolves.toBe(
      undefined,
    );
    expect(closePopup).toHaveBeenCalledTimes(1);
    expect(page.reload).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(2);
  });
});

describe("workflow recovery actions", () => {
  it("injects a single recovery-enabled page into the workflow", async () => {
    const originalError = new Error("popup");
    const textContent = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce("done");
    const locator = { textContent } as unknown as Locator;
    const rawPage = {
      locator: vi.fn(() => locator),
    } as unknown as Page;
    const recoveryAction = vi.fn(async () => undefined);

    const wf = workflow("recovery-workflow", {
      recoveryAction,
      handler: async ({ page }) => {
        return await page.locator("#result").textContent();
      },
    });

    await expect(wf.run({ session: "test", page: rawPage }, {})).resolves.toBe(
      "done",
    );
    expect(recoveryAction).toHaveBeenCalledTimes(1);
    expect(textContent).toHaveBeenCalledTimes(2);
  });

  it("supports recoveryAction in the schema definition argument", async () => {
    const originalError = new Error("popup");
    const textContent = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce("done");
    const locator = { textContent } as unknown as Locator;
    const rawPage = {
      locator: vi.fn(() => locator),
    } as unknown as Page;
    const recoveryAction = vi.fn(async () => undefined);

    const wf = workflow(
      "recovery-schema-workflow",
      {
        input: z.object({}),
        output: z.string(),
        recoveryAction,
      },
      async ({ page }) => {
        return (await page.locator("#result").textContent()) ?? "";
      },
    );

    await expect(wf.run({ session: "test", page: rawPage }, {})).resolves.toBe(
      "done",
    );
    expect(recoveryAction).toHaveBeenCalledTimes(1);
    expect(textContent).toHaveBeenCalledTimes(2);
  });
});

describe("computer use recovery model options", () => {
  it("rejects unsupported provider shortcut models", async () => {
    const recoveryAction = popupRecoveryAction({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o" as never,
    });

    await expect(
      recoveryAction({
        page: {} as Page,
        targetType: "page",
        method: "click",
        args: [],
        error: new Error("blocked"),
      }),
    ).rejects.toThrow(
      'Unsupported OpenAI computer use recovery model "gpt-4o". Supported model: gpt-5.5.',
    );
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
        "Set OPENAI_API_KEY or ANTHROPIC_API_KEY for the real popup recovery test.",
      );
    }

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

      const recoveryAction =
        provider === "anthropic"
          ? popupRecoveryAction({
              provider: "anthropic",
              apiKey,
              model: "claude-sonnet-4-6",
              maxSteps: 3,
            })
          : popupRecoveryAction({
              provider: "openai",
              apiKey,
              model: "gpt-5.5",
              maxSteps: 3,
            });
      const recoveryPage = createRecoveryPage(page, { recoveryAction });
      recoveryPage.setDefaultTimeout(500);

      try {
        await recoveryPage.locator("#target").click();
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
