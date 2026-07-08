import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import type { Snapshot } from "./snapshot/capture-snapshot.js";
import { snapshot as captureSnapshot } from "./snapshot/capture-snapshot.js";
import type { BrowserProvider } from "./provider.js";

interface SessionEntry {
	providerSessionId: string | undefined;
	providerName: string;
	/** True for browser_connect sessions — close detaches without killing the browser. */
	attached: boolean;
	browser: Browser;
	context: BrowserContext;
	currentPage: Page | undefined;
	pageById: Map<string, Page>;
	/** Post-exec snapshot baseline per page ID for snapshot diffs. */
	latestSnapshotByPageId: Map<string, Snapshot>;
}

export interface SessionPageSummary {
	pageId: string;
	url: string;
	active: boolean;
}

export interface SessionSummary {
	sessionId: string;
	provider: string;
	pages: SessionPageSummary[];
}

export interface PageStatus {
	pageId: string;
	url: string;
	title: string;
	viewport: { width: number; height: number } | null;
	active: boolean;
	readyState: string;
}

/**
 * In-process registry mapping public session IDs (`ses-4f2a`) to live
 * Playwright connections. Owned by a factory instance — no module-level
 * state. Sessions die with the process; `dispose()` closes everything.
 */
/** Signals we attempt best-effort cleanup on, when no host handler owns them. */
const EXIT_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

export class SessionRegistry {
	private readonly sessions = new Map<string, SessionEntry>();
	private exitHooksInstalled = false;

	constructor(public readonly provider: BrowserProvider) {}

	async openSession(): Promise<{ sessionId: string }> {
		const providerSession = await this.provider.createSession();
		const browser = await chromium.connectOverCDP(providerSession.cdpEndpoint);
		const context = browser.contexts()[0] ?? (await browser.newContext());
		const entry = this.createSessionEntry({
			providerSessionId: providerSession.sessionId,
			providerName: this.provider.name,
			attached: false,
			browser,
			context,
		});
		if (context.pages().length === 0) {
			await context.newPage();
		}
		for (const page of context.pages()) {
			this.trackPage(entry, page);
		}

		const sessionId = this.generateSessionId();
		this.sessions.set(sessionId, entry);
		this.installExitHooks();
		return { sessionId };
	}

	async connectSession(cdpEndpoint: string): Promise<{ sessionId: string }> {
		const browser = await chromium.connectOverCDP(cdpEndpoint);
		const context = browser.contexts()[0] ?? (await browser.newContext());
		const entry = this.createSessionEntry({
			providerSessionId: undefined,
			providerName: "attached",
			attached: true,
			browser,
			context,
		});
		for (const page of context.pages()) {
			this.trackPage(entry, page);
		}

		const sessionId = this.generateSessionId();
		this.sessions.set(sessionId, entry);
		this.installExitHooks();
		return { sessionId };
	}

	getCurrentPage(sessionId: string, pageId?: string): Page {
		const entry = this.requireSession(sessionId);
		if (pageId) {
			const page = entry.pageById.get(pageId);
			if (!page || page.isClosed()) {
				throw new Error(
					`Unknown page ID "${pageId}" in session "${sessionId}". ` +
						"Call browser_status to list open pages.",
				);
			}
			return page;
		}

		if (entry.currentPage && !entry.currentPage.isClosed()) {
			return entry.currentPage;
		}

		const openPages = [...entry.pageById.values()].filter((page) => !page.isClosed());
		const page = openPages.at(-1);
		if (!page) {
			throw new Error(`Session "${sessionId}" has no open pages`);
		}
		entry.currentPage = page;
		return page;
	}

	listSessions(): SessionSummary[] {
		return [...this.sessions].map(([sessionId, entry]) => ({
			sessionId,
			provider: entry.providerName,
			pages: this.listPagesForEntry(entry),
		}));
	}

	async getPageStatus(sessionId: string, pageId: string): Promise<PageStatus> {
		const page = this.getCurrentPage(sessionId, pageId);
		const activePage = this.getCurrentPage(sessionId);
		return {
			pageId,
			url: page.url(),
			title: await page.title(),
			viewport: page.viewportSize(),
			active: page === activePage,
			readyState: await page.evaluate(() => document.readyState),
		};
	}

	async closeSession(sessionId: string): Promise<void> {
		const entry = this.requireSession(sessionId);
		this.sessions.delete(sessionId);
		await entry.browser.close();
		if (!entry.attached && entry.providerSessionId) {
			await this.provider.closeSession(entry.providerSessionId);
		}
	}

	/** Baseline for the next exec diff — cached post-exec snapshot or a fresh capture. */
	async readSnapshotBaseline(
		sessionId: string,
		pageId?: string,
	): Promise<Snapshot> {
		const entry = this.requireSession(sessionId);
		const cacheKey = this.snapshotPageId(entry, sessionId, pageId);
		const cached = entry.latestSnapshotByPageId.get(cacheKey);
		if (cached) return cached;
		return captureSnapshot(this.getCurrentPage(sessionId, pageId));
	}

	/** Capture after exec and cache for the next call's baseline. */
	async captureSnapshotAfterExec(
		sessionId: string,
		pageId?: string,
	): Promise<Snapshot> {
		const entry = this.requireSession(sessionId);
		const cacheKey = this.snapshotPageId(entry, sessionId, pageId);
		const after = await captureSnapshot(this.getCurrentPage(sessionId, pageId));
		entry.latestSnapshotByPageId.set(cacheKey, after);
		return after;
	}

	clearSnapshotCache(sessionId: string): void {
		const entry = this.sessions.get(sessionId);
		if (entry) entry.latestSnapshotByPageId.clear();
	}

	async dispose(): Promise<void> {
		this.removeExitHooks();
		const sessionIds = [...this.sessions.keys()];
		for (const sessionId of sessionIds) {
			await this.closeSession(sessionId);
		}
	}

	/**
	 * Best-effort backstop so provider-owned (cloud) sessions get released even
	 * when a consumer forgets to call {@link dispose}. `beforeExit` covers a
	 * script that finishes naturally; signals are only claimed when no host
	 * handler already owns them, so we stay out of a host's own shutdown.
	 */
	private installExitHooks(): void {
		if (this.exitHooksInstalled) return;
		this.exitHooksInstalled = true;
		process.once("beforeExit", this.handleBeforeExit);
		for (const signal of EXIT_SIGNALS) {
			if (process.listenerCount(signal) === 0) {
				process.on(signal, this.handleSignal);
			}
		}
	}

	private removeExitHooks(): void {
		if (!this.exitHooksInstalled) return;
		this.exitHooksInstalled = false;
		process.removeListener("beforeExit", this.handleBeforeExit);
		for (const signal of EXIT_SIGNALS) {
			process.removeListener(signal, this.handleSignal);
		}
	}

	private readonly handleBeforeExit = (): void => {
		void this.dispose();
	};

	private readonly handleSignal = (signal: NodeJS.Signals): void => {
		// Adding a signal listener suppresses Node's default termination, so the
		// process stays alive while dispose() runs; re-raise afterward to restore
		// the default disposition (or defer to a handler the host added since).
		void this.dispose().finally(() => {
			process.removeListener(signal, this.handleSignal);
			process.kill(process.pid, signal);
		});
	};

	private createSessionEntry(args: {
		providerSessionId: string | undefined;
		providerName: string;
		attached: boolean;
		browser: Browser;
		context: BrowserContext;
	}): SessionEntry {
		const entry: SessionEntry = {
			providerSessionId: args.providerSessionId,
			providerName: args.providerName,
			attached: args.attached,
			browser: args.browser,
			context: args.context,
			currentPage: undefined,
			pageById: new Map(),
			latestSnapshotByPageId: new Map(),
		};
		// Newest page wins, so popups and tabs become current automatically.
		args.context.on("page", (page) => {
			this.trackPage(entry, page);
		});
		return entry;
	}

	private trackPage(entry: SessionEntry, page: Page): string {
		const existingPageId = this.findPageId(entry, page);
		if (existingPageId) {
			entry.currentPage = page;
			return existingPageId;
		}

		const pageId = this.generatePageId(entry.pageById);
		entry.pageById.set(pageId, page);
		page.on("close", () => {
			entry.pageById.delete(pageId);
			entry.latestSnapshotByPageId.delete(pageId);
			if (entry.currentPage === page) {
				entry.currentPage = undefined;
			}
		});
		entry.currentPage = page;
		return pageId;
	}

	private findPageId(entry: SessionEntry, page: Page): string | undefined {
		for (const [pageId, trackedPage] of entry.pageById) {
			if (trackedPage === page) return pageId;
		}
		return undefined;
	}

	private snapshotPageId(
		entry: SessionEntry,
		sessionId: string,
		pageId?: string,
	): string {
		if (pageId) {
			const page = entry.pageById.get(pageId);
			if (!page || page.isClosed()) {
				throw new Error(
					`Unknown page ID "${pageId}" in session "${sessionId}". ` +
						"Call browser_status to list open pages.",
				);
			}
			return pageId;
		}

		const page = this.getCurrentPage(sessionId);
		const resolvedPageId = this.findPageId(entry, page);
		if (!resolvedPageId) {
			throw new Error(
				`Session "${sessionId}" has no tracked page for the current tab.`,
			);
		}
		return resolvedPageId;
	}

	private listPagesForEntry(entry: SessionEntry): SessionPageSummary[] {
		const effectiveActive = this.getEffectiveActivePage(entry);
		const pages: SessionPageSummary[] = [];
		for (const [pageId, page] of entry.pageById) {
			if (page.isClosed()) continue;
			const url = page.url();
			if (url.startsWith("devtools://") || url.startsWith("chrome-error://")) {
				continue;
			}
			pages.push({
				pageId,
				url,
				active: page === effectiveActive,
			});
		}
		return pages;
	}

	private getEffectiveActivePage(entry: SessionEntry): Page | undefined {
		if (entry.currentPage && !entry.currentPage.isClosed()) {
			for (const page of entry.pageById.values()) {
				if (page === entry.currentPage) return entry.currentPage;
			}
		}
		return [...entry.pageById.values()].filter((page) => !page.isClosed()).at(-1);
	}

	private requireSession(sessionId: string): SessionEntry {
		const entry = this.sessions.get(sessionId);
		if (!entry) {
			throw new Error(`Unknown session ID: ${sessionId}`);
		}
		return entry;
	}

	private generateSessionId(): string {
		let sessionId: string;
		do {
			sessionId = `ses-${randomBytes(2).toString("hex")}`;
		} while (this.sessions.has(sessionId));
		return sessionId;
	}

	private generatePageId(pageById: Map<string, Page>): string {
		let pageId: string;
		do {
			pageId = `page-${randomBytes(2).toString("hex")}`;
		} while (pageById.has(pageId));
		return pageId;
	}
}
