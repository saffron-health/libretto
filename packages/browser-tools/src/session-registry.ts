import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import type { DomainPolicyOptions } from "./domain-policy.js";
import {
	DomainPolicyRestricted,
	isUrlAllowed,
} from "./domain-policy.js";
import type { Snapshot } from "./snapshot/capture-snapshot.js";
import { snapshot as captureSnapshot } from "./snapshot/capture-snapshot.js";
import {
	AuthProfileError,
	type BrowserProvider,
	type CreateBrowserSessionOptions,
} from "./provider.js";

function resolveCreateSessionOptions(
	provider: BrowserProvider,
	authProfile: string | undefined,
): AuthProfileError | CreateBrowserSessionOptions | null {
	if (authProfile === undefined) return null;
	if (!authProfile.trim()) {
		return new AuthProfileError({
			message: "Auth profile name is empty.",
			recovery: "Pass a non-empty authProfile to browser_open.",
		});
	}
	if (!provider.supportsAuthProfiles) {
		return new AuthProfileError({
			message: `Browser provider "${provider.name}" does not support auth profiles.`,
			recovery:
				"Call browser_open without authProfile, or ask the toolkit developer to configure a provider that supports auth profiles.",
		});
	}
	return { authProfile };
}

type SessionEntry = {
	providerSessionId: string | undefined;
	providerName: string;
	sessionSource: "existing-page" | "existing-cdp" | "new-session";
	browser: Browser;
	context: BrowserContext;
	currentPage: Page | undefined;
	pageById: Map<string, Page>;
	contextPageListener: (page: Page) => void;
	pageCloseListenerByPage: Map<Page, () => void>;
	/** Post-exec snapshot baseline per page for snapshot diffs. */
	latestSnapshotByPage: Map<Page, Snapshot>;
}

export type SessionPageSummary = {
	pageId: string;
	url: string;
	active: boolean;
}

export type SessionSummary = {
	sessionId: string;
	provider: string;
	pages: SessionPageSummary[];
}

export type PageStatus = {
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
 * state. `dispose()` closes owned sessions and detaches borrowed pages.
 */
export class SessionRegistry {
	private readonly sessions = new Map<string, SessionEntry>();
	private readonly blockedNavigationByContext = new WeakMap<
		BrowserContext,
		DomainPolicyRestricted
	>();
	private beforeExitHookInstalled = false;

	constructor(
		public readonly provider: BrowserProvider | undefined,
		private readonly domainPolicy: DomainPolicyOptions = {},
	) {}

	async openSession(
		options: CreateBrowserSessionOptions = {},
	): Promise<AuthProfileError | { sessionId: string }> {
		const provider = this.provider;
		if (!provider) {
			throw new Error("This browser toolkit only operates on its attached page.");
		}
		const createOptions = resolveCreateSessionOptions(
			provider,
			options.authProfile,
		);
		if (createOptions instanceof Error) return createOptions;

		const providerSession =
			createOptions === null
				? await provider.createSession()
				: await provider.createSession(createOptions);
		if (providerSession instanceof AuthProfileError) return providerSession;
		let browser: Browser | undefined;
		try {
			browser = await chromium.connectOverCDP(providerSession.cdpEndpoint);
			const context = browser.contexts()[0] ?? (await browser.newContext());
			await this.applyDomainPolicy(context);
			this.assertCurrentPagesAllowed(context);
			const entry = this.createSessionEntry({
				providerSessionId: providerSession.sessionId,
				providerName: provider.name,
				sessionSource: "new-session",
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
			this.installBeforeExitHook();
			return { sessionId };
		} catch (error) {
			await browser?.close().catch(() => {});
			await provider.closeSession(providerSession.sessionId).catch(() => {});
			throw error;
		}
	}

	async connectSession(cdpEndpoint: string): Promise<{ sessionId: string }> {
		const browser = await chromium.connectOverCDP(cdpEndpoint);
		try {
			const context = browser.contexts()[0] ?? (await browser.newContext());
			await this.applyDomainPolicy(context);
			this.assertCurrentPagesAllowed(context);
			const entry = this.createSessionEntry({
				providerSessionId: undefined,
				providerName: "attached",
				sessionSource: "existing-cdp",
				browser,
				context,
			});
			for (const page of context.pages()) {
				this.trackPage(entry, page);
			}

			const sessionId = this.generateSessionId();
			this.sessions.set(sessionId, entry);
			this.installBeforeExitHook();
			return { sessionId };
		} catch (error) {
			await browser.close().catch(() => {});
			throw error;
		}
	}

	attachPage(page: Page): { sessionId: string } {
		const context = page.context();
		const browser = context.browser();
		if (!browser) {
			throw new Error("The supplied page is not connected to a Playwright browser.");
		}
		const entry = this.createSessionEntry({
			providerSessionId: undefined,
			providerName: "borrowed-page",
			sessionSource: "existing-page",
			browser,
			context,
		});
		for (const contextPage of context.pages()) {
			this.trackPage(entry, contextPage);
		}
		this.trackPage(entry, page);

		const sessionId = this.generateSessionId();
		this.sessions.set(sessionId, entry);
		this.installBeforeExitHook();
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
		this.releaseSessionEntry(entry);
		if (entry.sessionSource === "existing-page") return;
		await entry.browser.close();
		if (entry.sessionSource === "new-session" && entry.providerSessionId) {
			await this.provider?.closeSession(entry.providerSessionId);
		}
	}

	/** Baseline for the next exec diff — cached post-exec snapshot or a fresh capture. */
	async readSnapshotBaseline(
		sessionId: string,
		pageId?: string,
	): Promise<Snapshot> {
		const entry = this.requireSession(sessionId);
		const page = this.getCurrentPage(sessionId, pageId);
		const cached = entry.latestSnapshotByPage.get(page);
		if (cached) return cached;
		return captureSnapshot(page);
	}

	/** Capture after exec and cache for the next call's baseline. */
	async captureSnapshotAfterExec(
		sessionId: string,
		pageId?: string,
	): Promise<Snapshot> {
		const entry = this.requireSession(sessionId);
		const page = this.getCurrentPage(sessionId, pageId);
		const after = await captureSnapshot(page);
		entry.latestSnapshotByPage.set(page, after);
		return after;
	}

	clearSnapshotCache(sessionId: string): void {
		const entry = this.sessions.get(sessionId);
		if (entry) entry.latestSnapshotByPage.clear();
	}

	consumeBlockedNavigationError(
		page: Page,
	): DomainPolicyRestricted | undefined {
		const context = page.context();
		const error = this.blockedNavigationByContext.get(context);
		this.blockedNavigationByContext.delete(context);
		return error;
	}

	async dispose(): Promise<void> {
		this.removeBeforeExitHook();
		const sessionIds = [...this.sessions.keys()];
		for (const sessionId of sessionIds) {
			await this.closeSession(sessionId);
		}
	}

	/**
	 * Best-effort backstop so provider-owned (cloud) sessions get released even
	 * when a consumer forgets to call {@link dispose} and the process exits
	 * naturally. Hosts remain responsible for cleanup during signal handling.
	 */
	private installBeforeExitHook(): void {
		if (this.beforeExitHookInstalled) return;
		this.beforeExitHookInstalled = true;
		process.once("beforeExit", this.handleBeforeExit);
	}

	private removeBeforeExitHook(): void {
		if (!this.beforeExitHookInstalled) return;
		this.beforeExitHookInstalled = false;
		process.removeListener("beforeExit", this.handleBeforeExit);
	}

	private readonly handleBeforeExit = (): void => {
		void this.dispose();
	};

	private async applyDomainPolicy(context: BrowserContext): Promise<void> {
		if (
			this.domainPolicy.allowedDomains === undefined &&
			!this.domainPolicy.blockedDomains?.length
		) {
			return;
		}

		await context.route("**/*", async (route, request) => {
			const url = request.url();
			if (isUrlAllowed(url, this.domainPolicy)) {
				await route.continue();
				return;
			}

			if (request.isNavigationRequest()) {
				const frame = request.frame();
				if (frame === frame.page().mainFrame()) {
					this.blockedNavigationByContext.set(
						context,
						new DomainPolicyRestricted(this.domainPolicy, url),
					);
				}
			}
			await route.abort("blockedbyclient");
		});
	}

	private assertCurrentPagesAllowed(context: BrowserContext): void {
		for (const page of context.pages()) {
			const url = page.url();
			if (!isUrlAllowed(url, this.domainPolicy)) {
				throw new DomainPolicyRestricted(this.domainPolicy, url);
			}
		}
	}

	private createSessionEntry(args: {
		providerSessionId: string | undefined;
		providerName: string;
		sessionSource: SessionEntry["sessionSource"];
		browser: Browser;
		context: BrowserContext;
	}): SessionEntry {
		const entry: SessionEntry = {
			providerSessionId: args.providerSessionId,
			providerName: args.providerName,
			sessionSource: args.sessionSource,
			browser: args.browser,
			context: args.context,
			currentPage: undefined,
			pageById: new Map(),
			contextPageListener: () => {},
			pageCloseListenerByPage: new Map(),
			latestSnapshotByPage: new Map(),
		};
		// Newest page wins, so popups and tabs become current automatically.
		entry.contextPageListener = (page) => {
			this.trackPage(entry, page);
		};
		args.context.on("page", entry.contextPageListener);
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
		const closeListener = () => {
			entry.pageById.delete(pageId);
			entry.pageCloseListenerByPage.delete(page);
			entry.latestSnapshotByPage.delete(page);
			if (entry.currentPage === page) {
				entry.currentPage = undefined;
			}
		};
		entry.pageCloseListenerByPage.set(page, closeListener);
		page.on("close", closeListener);
		entry.currentPage = page;
		return pageId;
	}

	private releaseSessionEntry(entry: SessionEntry): void {
		entry.context.off("page", entry.contextPageListener);
		for (const [page, listener] of entry.pageCloseListenerByPage) {
			page.off("close", listener);
		}
		entry.pageCloseListenerByPage.clear();
		entry.pageById.clear();
		entry.latestSnapshotByPage.clear();
		entry.currentPage = undefined;
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
