import { chromium, errors } from "playwright";
import { describe, expect, it } from "vitest";
import {
	enrichPlaywrightTimeoutMessage,
	errorMessage,
	isPlaywrightTimeoutError,
} from "./errors.js";

const HIDDEN_CLICK_TIMEOUT = `
locator.click: Timeout 800ms exceeded.
Call log:
  - waiting for locator('#t')
    - locator resolved to <button id="t">Hidden</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
      - waiting 20ms
`.trim();

const OVERLAY_CLICK_TIMEOUT = `
locator.click: Timeout 800ms exceeded.
Call log:
  - waiting for locator('#t')
    - locator resolved to <button id="t">Target</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div id="overlay" aria-label="Cookie banner"></div> intercepts pointer events
    - retrying click action
      - waiting 20ms
`.trim();

const DISABLED_CLICK_TIMEOUT = `
locator.click: Timeout 800ms exceeded.
Call log:
  - waiting for locator('#t')
    - locator resolved to <button id="t" disabled>Disabled</button>
  - attempting click action
      - element is not enabled
`.trim();

describe("isPlaywrightTimeoutError", () => {
	it("recognizes Playwright errors.TimeoutError by instanceof", () => {
		const error = new errors.TimeoutError("Timeout 800ms exceeded.");
		expect(isPlaywrightTimeoutError(error)).toBe(true);
	});

	it("recognizes re-wrapped TimeoutError by name + message shape", () => {
		const error = new Error("locator.click: Timeout 800ms exceeded.");
		error.name = "TimeoutError";
		expect(isPlaywrightTimeoutError(error)).toBe(true);
	});

	it("rejects ordinary errors", () => {
		expect(isPlaywrightTimeoutError(new Error("boom"))).toBe(false);
		expect(isPlaywrightTimeoutError("Timeout 800ms exceeded.")).toBe(false);
	});
});

describe("enrichPlaywrightTimeoutMessage", () => {
	it("promotes a hidden-element Call-log reason into the headline with a tip", () => {
		const enriched = enrichPlaywrightTimeoutMessage(HIDDEN_CLICK_TIMEOUT);
		expect(enriched.split("\n")[0]).toBe(
			"locator.click: Timeout 800ms exceeded. Element is not visible — it may be hidden by CSS, inside a collapsed <details>, inactive tab, or closed accordion. Reveal it first, then retry.",
		);
		expect(enriched).toContain("Call log:");
		expect(enriched).toContain("element is not visible");
	});

	it("promotes an intercepting element into the headline with a next step", () => {
		const enriched = enrichPlaywrightTimeoutMessage(OVERLAY_CLICK_TIMEOUT);
		expect(enriched.split("\n")[0]).toBe(
			'locator.click: Timeout 800ms exceeded. <div id="overlay" aria-label="Cookie banner"></div> intercepts pointer events — call browser_snapshot and interact with the covering element (modal/overlay), then retry.',
		);
	});

	it("promotes disabled / not-enabled reasons without inventing tips", () => {
		const enriched = enrichPlaywrightTimeoutMessage(DISABLED_CLICK_TIMEOUT);
		expect(enriched.split("\n")[0]).toBe(
			"locator.click: Timeout 800ms exceeded. Element is not enabled",
		);
	});

	it("leaves already-enriched headlines alone", () => {
		const already =
			"locator.click: Timeout 800ms exceeded. Element is not stable\nCall log:\n  - element is not stable";
		expect(enrichPlaywrightTimeoutMessage(already)).toBe(already);
	});

	it("leaves not-found timeouts without an actionability reason alone", () => {
		const notFound = `
locator.click: Timeout 800ms exceeded.
Call log:
  - waiting for locator('#missing')
`.trim();
		expect(enrichPlaywrightTimeoutMessage(notFound)).toBe(notFound);
	});
});

describe("errorMessage", () => {
	it("enriches TimeoutError instances from a live Playwright click", async () => {
		const browser = await chromium.launch({ headless: true });
		const page = await browser.newPage();
		page.setDefaultTimeout(500);
		await page.setContent(
			`<button id="t">Target</button><div id="overlay" style="position:fixed;inset:0"></div>`,
		);

		let thrown: unknown;
		try {
			await page.locator("#t").click();
		} catch (error) {
			thrown = error;
		}
		await browser.close();

		expect(thrown).toBeInstanceOf(errors.TimeoutError);
		const formatted = errorMessage(thrown);
		expect(formatted.split("\n")[0]).toMatch(
			/^locator\.click: Timeout 500ms exceeded\. <div id="overlay"><\/div> intercepts pointer events —/,
		);
		expect(formatted).toContain("browser_snapshot");
	});

	it("passes through non-timeout errors unchanged", () => {
		expect(errorMessage(new Error("boom"))).toBe("boom");
		expect(errorMessage("plain")).toBe("plain");
	});
});
