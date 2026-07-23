import type { Browser, Page } from "playwright";
import { chromium } from "playwright";

/**
 * Providers own browser launch, Playwright attachment, page selection, and
 * cleanup. Per-session launch options go on createSession.
 */
export type ProviderSessionCreateOptions = {
	startUrl?: string;
	gpu?: boolean;
	viewport?: { width: number; height: number };
}

export type BrowserProvider = {
	/** Shown in `status` output, e.g. "local", "kernel". */
	readonly name: string;
	createSession(
		options?: ProviderSessionCreateOptions,
	): Promise<ProviderSession>;
	closeSession(sessionId: string): Promise<ProviderSessionClosed>;
}

export type ProviderSession = {
	/** Provider-scoped session identifier. */
	sessionId: string;
	/** The page selected by the provider for this logical session. */
	page: Page;
	liveViewUrl?: string;
	recordingUrl?: string;
	/**
	 * True when the provider opened startUrl before CDP attach. Callers should
	 * not navigate again with page.goto in that case.
	 */
	startUrlPreloaded?: boolean;
}

export type ProviderSessionClosed = {
	replayUrl?: string;
}

const cdpEndpointBySession = new WeakMap<ProviderSession, string>();

/** @internal Used by the benchmark harness. */
export function getProviderSessionCdpEndpoint(
	session: ProviderSession,
): string | undefined {
	return cdpEndpointBySession.get(session);
}

/** @internal Used by providers that expose their endpoint to benchmarks. */
export function setProviderSessionCdpEndpoint(
	session: ProviderSession,
	cdpEndpoint: string,
): void {
	cdpEndpointBySession.set(session, cdpEndpoint);
}

/** @internal Connects a provider endpoint and selects its initial page. */
export async function connectProviderPage(
	cdpEndpoint: string,
): Promise<{ browser: Browser; page: Page }> {
	let browser: Browser | undefined;
	try {
		browser = await chromium.connectOverCDP(cdpEndpoint);
		const context = browser.contexts()[0] ?? (await browser.newContext());
		const page = context.pages().at(-1) ?? (await context.newPage());
		return { browser, page };
	} catch (error) {
		await browser?.close().catch(() => {});
		throw error;
	}
}

/** @internal Runs Playwright and provider cleanup even if either one fails. */
export async function closeProviderBrowser(
	browser: Browser,
	closeProvider: () => Promise<void>,
): Promise<void> {
	const errors: unknown[] = [];
	try {
		await browser.close();
	} catch (error) {
		errors.push(error);
	}
	try {
		await closeProvider();
	} catch (error) {
		errors.push(error);
	}
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) {
		throw new AggregateError(errors, "Failed to close browser provider session");
	}
}
