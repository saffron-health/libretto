import type { Page, Locator, FrameLocator, BrowserContext } from "playwright";
import type { MinimalLogger } from "../logger/logger.js";
import type { GhostCursorOptions } from "../visualization/ghost-cursor.js";
import type { HighlightOptions } from "../visualization/highlight.js";
import {
	ensureGhostCursor,
	moveGhostCursor,
	moveGhostCursorWithDistance,
	ghostClick,
	getGhostCursorPosition,
} from "../visualization/ghost-cursor.js";
import {
	ensureHighlightLayer,
	showHighlight,
	clearHighlights,
} from "../visualization/highlight.js";
import { enrichTimeoutError } from "./errors.js";

export type InstrumentationOptions = {
	visualize?: boolean;
	logger?: MinimalLogger;
	highlightBeforeActionMs?: number;
	ghostCursor?: GhostCursorOptions;
	highlight?: HighlightOptions;
};

export type InstrumentedPage = Page & {
	__librettoInstrumented: true;
};

const LOCATOR_ACTIONS = [
	"click",
	"dblclick",
	"hover",
	"fill",
	"type",
	"press",
	"check",
	"uncheck",
	"selectOption",
	"focus",
] as const;

const NAV_ACTIONS = ["goto", "reload", "goBack", "goForward"] as const;

const POINTER_ACTIONS = new Set<string>(["click", "dblclick", "hover"]);

const instrumentedTargets = new WeakSet<object>();

// Per-page serialization queue so overlapping visualization actions don't glitch
const pageQueues = new WeakMap<Page, Promise<void>>();

function enqueue(page: Page, fn: () => Promise<void>): Promise<void> {
	const prev = pageQueues.get(page) ?? Promise.resolve();
	const next = prev.then(fn, fn);
	pageQueues.set(page, next);
	return next;
}

async function visualizeBeforeAction(
	page: Page,
	box: { x: number; y: number; width: number; height: number } | null,
	actionName: string,
	highlightMs: number,
): Promise<void> {
	if (!box) return;

	// Re-ensure overlays in case DOM was replaced (e.g. page.setContent()).
	await ensureGhostCursor(page);
	await ensureHighlightLayer(page);

	const centerX = box.x + box.width / 2;
	const centerY = box.y + box.height / 2;

	// Show highlight on the target element
	await showHighlight(page, {
		box,
		durationMs: highlightMs + 200, // keep visible a bit past the cursor arrival
	});

	// Move ghost cursor to target
	const cursorPos = await getGhostCursorPosition(page);
	if (cursorPos) {
		await moveGhostCursorWithDistance(page, cursorPos, {
			x: centerX,
			y: centerY,
		});
	} else {
		await moveGhostCursor(page, { x: centerX, y: centerY, durationMs: 200 });
	}

	// For click actions, show click feedback
	if (actionName === "click" || actionName === "dblclick") {
		await ghostClick(page, { x: centerX, y: centerY });
	}
}

async function visualizeAfterAction(page: Page): Promise<void> {
	await clearHighlights(page);
}

function wrapLocatorActions(
	locator: Locator,
	page: Page,
	opts: Required<Pick<InstrumentationOptions, "visualize" | "highlightBeforeActionMs">> & InstrumentationOptions,
): void {
	for (const method of LOCATOR_ACTIONS) {
		if (typeof (locator as any)[method] !== "function") continue;
		const orig = (locator as any)[method].bind(locator);

		(locator as any)[method] = async (...args: any[]) => {
			if (opts.visualize) {
				await enqueue(page, async () => {
					try {
						const box = await locator.boundingBox();
						await visualizeBeforeAction(
							page,
							box,
							method,
							opts.highlightBeforeActionMs,
						);
					} catch {
						// Best-effort visualization
					}
				});
			}

			try {
				const result = await orig(...args);
				if (opts.visualize) {
					enqueue(page, () => visualizeAfterAction(page));
				}
				return result;
			} catch (err: any) {
				if (opts.visualize) {
					enqueue(page, () => visualizeAfterAction(page));
				}
				// Enrich timeout errors for pointer actions
				if (POINTER_ACTIONS.has(method) && isTimeoutError(err)) {
					await enrichTimeoutError(err, locator, page);
				}
				throw err;
			}
		};
	}
}

const LOCATOR_FACTORY_METHODS = [
	"locator",
	"getByRole",
	"getByText",
	"getByLabel",
	"getByPlaceholder",
	"getByAltText",
	"getByTitle",
	"getByTestId",
	"filter",
	"and",
	"or",
	"first",
	"last",
	"nth",
] as const;

const FRAME_LOCATOR_FACTORY_METHODS = [
	"locator",
	"getByRole",
	"getByText",
	"getByLabel",
	"getByPlaceholder",
	"getByAltText",
	"getByTitle",
	"getByTestId",
	"owner",
	"first",
	"last",
	"nth",
] as const;

type InstrumentationRuntimeOptions =
	Required<Pick<InstrumentationOptions, "visualize" | "highlightBeforeActionMs">> &
	InstrumentationOptions;

function instrumentLocator(
	locator: Locator,
	page: Page,
	opts: InstrumentationRuntimeOptions,
): Locator {
	const target = locator as object;
	if (instrumentedTargets.has(target)) {
		return locator;
	}
	instrumentedTargets.add(target);

	wrapLocatorActions(locator, page, opts);

	for (const method of LOCATOR_FACTORY_METHODS) {
		if (typeof (locator as any)[method] !== "function") continue;
		const orig = (locator as any)[method].bind(locator);
		(locator as any)[method] = (...args: any[]) => {
			const nextLocator = orig(...args);
			return instrumentLocator(nextLocator, page, opts);
		};
	}

	if (typeof (locator as any).contentFrame === "function") {
		const origContentFrame = (locator as any).contentFrame.bind(locator);
		(locator as any).contentFrame = (...args: any[]) => {
			const frameLocator = origContentFrame(...args);
			return instrumentFrameLocator(frameLocator, page, opts);
		};
	}

	return locator;
}

function instrumentFrameLocator(
	frameLocator: FrameLocator,
	page: Page,
	opts: InstrumentationRuntimeOptions,
): FrameLocator {
	const target = frameLocator as object;
	if (instrumentedTargets.has(target)) {
		return frameLocator;
	}
	instrumentedTargets.add(target);

	for (const method of FRAME_LOCATOR_FACTORY_METHODS) {
		if (typeof (frameLocator as any)[method] !== "function") continue;
		const orig = (frameLocator as any)[method].bind(frameLocator);
		(frameLocator as any)[method] = (...args: any[]) => {
			const result = orig(...args);
			if (method === "owner") {
				return instrumentLocator(result, page, opts);
			}
			return instrumentLocator(result, page, opts);
		};
	}

	if (typeof (frameLocator as any).frameLocator === "function") {
		const origFrameLocator = (frameLocator as any).frameLocator.bind(frameLocator);
		(frameLocator as any).frameLocator = (...args: any[]) => {
			const nestedFrameLocator = origFrameLocator(...args);
			return instrumentFrameLocator(nestedFrameLocator, page, opts);
		};
	}

	return frameLocator;
}

function isTimeoutError(err: any): boolean {
	if (!err || typeof err.message !== "string") return false;
	return (
		err.message.includes("Timeout") ||
		err.message.includes("timeout") ||
		err.name === "TimeoutError"
	);
}

const PAGE_LOCATOR_FACTORIES = [
	"locator",
	"getByRole",
	"getByText",
	"getByLabel",
	"getByPlaceholder",
	"getByAltText",
	"getByTitle",
	"getByTestId",
] as const;

const PAGE_FRAME_LOCATOR_FACTORIES = ["frameLocator"] as const;

/**
 * In-place patching of a Page object to add visualization and error enrichment.
 * Modifies the page directly (does not return a new object).
 */
export async function installInstrumentation(
	page: Page,
	options?: InstrumentationOptions,
): Promise<void> {
	if ((page as any).__librettoInstrumented) return;
	(page as any).__librettoInstrumented = true;

	const visualize = options?.visualize ?? false;
	const highlightBeforeActionMs = options?.highlightBeforeActionMs ?? 350;
	const mergedOpts = { ...options, visualize, highlightBeforeActionMs };

	// Install overlay layers if visualization is on
	if (visualize) {
		await ensureGhostCursor(page, options?.ghostCursor);
		await ensureHighlightLayer(page, options?.highlight);
	}

	// Wrap page-level locator actions (page.click, page.fill, etc.)
	for (const method of LOCATOR_ACTIONS) {
		if (typeof (page as any)[method] !== "function") continue;
		const orig = (page as any)[method].bind(page);
		(page as any)[method] = async (...args: any[]) => {
			// For page-level actions, the first arg is typically the selector
			if (visualize && typeof args[0] === "string") {
				await enqueue(page, async () => {
					try {
						const loc = page.locator(args[0]);
						const box = await loc.boundingBox();
						await visualizeBeforeAction(page, box, method, highlightBeforeActionMs);
					} catch {
						// Best-effort
					}
				});
			}

			try {
				const result = await orig(...args);
				if (visualize) {
					enqueue(page, () => visualizeAfterAction(page));
				}
				return result;
			} catch (err: any) {
				if (visualize) {
					enqueue(page, () => visualizeAfterAction(page));
				}
				if (POINTER_ACTIONS.has(method) && isTimeoutError(err) && typeof args[0] === "string") {
					await enrichTimeoutError(err, page.locator(args[0]), page);
				}
				throw err;
			}
		};
	}

	// Wrap navigation actions (no visualization, just logging)
	for (const method of NAV_ACTIONS) {
		if (typeof (page as any)[method] !== "function") continue;
		const orig = (page as any)[method].bind(page);
		(page as any)[method] = async (...args: any[]) => {
			options?.logger?.info(`instrumentation:${method}`, {
				url: typeof args[0] === "string" ? args[0] : page.url(),
			});
			return orig(...args);
		};
	}

	// Wrap locator factories to instrument returned locators
	for (const factory of PAGE_LOCATOR_FACTORIES) {
		if (typeof (page as any)[factory] !== "function") continue;
		const origFactory = (page as any)[factory].bind(page);
		(page as any)[factory] = (...factoryArgs: any[]) => {
			const locator = origFactory(...factoryArgs);
			return instrumentLocator(locator, page, mergedOpts);
		};
	}

	for (const factory of PAGE_FRAME_LOCATOR_FACTORIES) {
		if (typeof (page as any)[factory] !== "function") continue;
		const origFactory = (page as any)[factory].bind(page);
		(page as any)[factory] = (...factoryArgs: any[]) => {
			const frameLocator = origFactory(...factoryArgs);
			return instrumentFrameLocator(frameLocator, page, mergedOpts);
		};
	}
}

/**
 * Returns a new object that proxies to the page with instrumentation applied.
 * The original page is not modified.
 */
export async function instrumentPage(
	page: Page,
	options?: InstrumentationOptions,
): Promise<InstrumentedPage> {
	await installInstrumentation(page, options);
	return page as InstrumentedPage;
}

/**
 * Install overlays on a page and auto-install on all future pages in the context.
 * Useful when connecting to an existing browser via CDP.
 */
export async function instrumentContext(
	context: BrowserContext,
	options?: InstrumentationOptions,
): Promise<void> {
	// Instrument all existing pages
	for (const page of context.pages()) {
		await installInstrumentation(page, options);
	}

	// Auto-instrument new pages
	context.on("page", async (page) => {
		await installInstrumentation(page, options);
	});
}
