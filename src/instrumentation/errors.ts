import type { Page, Locator } from "playwright";

/**
 * Enrich a timeout error from a pointer action (click/dblclick/hover) with
 * diagnostic information about why the action may have failed.
 *
 * Mutates err.message in-place to append the enrichment.
 * Best-effort: if any probe fails, we skip that check silently.
 */
export async function enrichTimeoutError(
	err: any,
	locator: Locator,
	page: Page,
): Promise<void> {
	const reasons: string[] = [];

	try {
		const visible = await locator.isVisible().catch(() => null);
		if (visible === false) {
			reasons.push("Element is not visible");
		}

		// isInViewport is available in modern Playwright but may not exist in older versions
		if (typeof (locator as any).isInViewport === "function") {
			const inViewport = await (locator as any).isInViewport().catch(() => null);
			if (inViewport === false) {
				reasons.push("Element is outside of the viewport");
			}
		}

		const enabled = await locator.isEnabled().catch(() => null);
		if (enabled === false) {
			reasons.push("Element is not enabled (disabled)");
		}

		// If the element appears visible and in viewport, check for intercepting elements
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

							// Build a brief preview of the intercepting element
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
