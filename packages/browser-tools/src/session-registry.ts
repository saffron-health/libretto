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
	latestSnapshot?: Snapshot;
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
export class SessionRegistry {
	private readonly sessions = new Map<string, SessionEntry>();

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
		return { sessionId };
	}

	getCurrentPage(sessionId: string): Page {
		return this.resolvePage(sessionId);
	}

	resolvePage(sessionId: string, pageId?: string): Page {
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
		const summaries: SessionSummary[] = [];
		for (const [sessionId, entry] of this.sessions) {
			summaries.push({
				sessionId,
				provider: entry.providerName,
				pages: this.listPagesForEntry(entry),
			});
		}
		return summaries;
	}

	listSessionPages(sessionId: string): SessionPageSummary[] {
		return this.listPagesForEntry(this.requireSession(sessionId));
	}

	async getPageStatus(sessionId: string, pageId: string): Promise<PageStatus> {
		const page = this.resolvePage(sessionId, pageId);
		const activePage = this.resolvePage(sessionId);
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
		if (!pageId && entry.latestSnapshot) return entry.latestSnapshot;
		return captureSnapshot(this.resolvePage(sessionId, pageId));
	}

	/** Capture after exec and cache for the next call's baseline. */
	async captureSnapshotAfterExec(
		sessionId: string,
		pageId?: string,
	): Promise<Snapshot> {
		const entry = this.requireSession(sessionId);
		const after = await captureSnapshot(this.resolvePage(sessionId, pageId));
		if (!pageId) entry.latestSnapshot = after;
		return after;
	}

	clearSnapshotCache(sessionId: string): void {
		const entry = this.sessions.get(sessionId);
		if (entry) delete entry.latestSnapshot;
	}

	async dispose(): Promise<void> {
		const sessionIds = [...this.sessions.keys()];
		for (const sessionId of sessionIds) {
			await this.closeSession(sessionId);
		}
	}

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
