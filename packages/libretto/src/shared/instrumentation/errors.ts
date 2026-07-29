import type { Page, Locator } from "playwright";
import {
  enrichPlaywrightTimeoutMessage,
  isPlaywrightTimeoutError,
} from "../errors/playwright-timeout.js";

/**
 * Enrich a timeout error from a pointer action (click/dblclick/hover).
 *
 * Prefer Playwright's own Call-log actionability reason (promoted into the
 * timeout headline). Fall back to live page probes only when the Call log has
 * no actionability line.
 *
 * Mutates err.message in-place. Best-effort: probe failures are ignored.
 */
export async function enrichTimeoutError(
  err: any,
  locator: Locator,
  page: Page,
): Promise<void> {
  if (!err || typeof err.message !== "string") return;

  const before = err.message as string;
  const fromCallLog = enrichPlaywrightTimeoutMessage(before);
  if (fromCallLog !== before) {
    err.message = fromCallLog;
    return;
  }

  if (!isPlaywrightTimeoutError(err) && !/Timeout \d+ms exceeded/i.test(before)) {
    return;
  }

  // Headline already has a reason, or Call log had none — only probe as fallback
  // when the headline is still a bare timeout.
  if (!/Timeout \d+ms exceeded\.\s*$/m.test(before.split("\n")[0] ?? "")) {
    return;
  }

  const reasons: string[] = [];

  try {
    const visible = await locator.isVisible().catch(() => null);
    if (visible === false) {
      reasons.push("Element is not visible");
    }

    if (typeof (locator as any).isInViewport === "function") {
      const inViewport = await (locator as any)
        .isInViewport()
        .catch(() => null);
      if (inViewport === false) {
        reasons.push("Element is outside of the viewport");
      }
    }

    const enabled = await locator.isEnabled().catch(() => null);
    if (enabled === false) {
      reasons.push("Element is not enabled (disabled)");
    }

    if (reasons.length === 0) {
      const box = await locator.boundingBox().catch(() => null);
      if (box) {
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;

        const interceptInfo = await page
          .evaluate(
            ({ x, y }) => {
              const els = document.elementsFromPoint(x, y);
              if (!els || els.length < 2) return null;
              const topEl = els[0];
              if (!topEl) return null;

              const tag = topEl.tagName.toLowerCase();
              const id = topEl.id ? `#${topEl.id}` : "";
              const cls = topEl.className
                ? `.${String(topEl.className).split(/\s+/).slice(0, 2).join(".")}`
                : "";
              const text = (topEl.textContent || "").trim().slice(0, 40);
              return {
                tag,
                preview: `<${tag}${id}${cls}>${text ? ` "${text}"` : ""}`,
              };
            },
            { x: centerX, y: centerY },
          )
          .catch(() => null);

        if (interceptInfo) {
          reasons.push(
            `Element may be intercepted by ${interceptInfo.preview}`,
          );
        }
      }
    }
  } catch {
    // All enrichment is best-effort
  }

  if (reasons.length > 0) {
    const enrichment = `\n[libretto diagnostics] ${reasons.join("; ")}`;
    err.message = (err.message || "") + enrichment;
  }
}
