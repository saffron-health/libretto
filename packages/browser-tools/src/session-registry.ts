import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import type { BrowserProvider } from "./provider.js";

interface SessionEntry {
	providerSessionId: string;
	browser: Browser;
	context: BrowserContext;
	currentPage: Page | undefined;
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
		const existingPages = context.pages();
		const entry: SessionEntry = {
			providerSessionId: providerSession.sessionId,
			browser,
			context,
			currentPage: existingPages[existingPages.length - 1],
		};
		// Newest page wins, so popups and tabs become current automatically.
		context.on("page", (page) => {
			entry.currentPage = page;
		});
		if (context.pages().length === 0) {
			await context.newPage();
		}

		const sessionId = this.generateSessionId();
		this.sessions.set(sessionId, entry);
		return { sessionId };
	}

	getCurrentPage(sessionId: string): Page {
		const entry = this.requireSession(sessionId);
		if (entry.currentPage && !entry.currentPage.isClosed()) {
			return entry.currentPage;
		}
		const pages = entry.context.pages();
		const page = pages[pages.length - 1];
		if (!page) {
			throw new Error(`Session "${sessionId}" has no open pages`);
		}
		return page;
	}

	async closeSession(sessionId: string): Promise<void> {
		const entry = this.requireSession(sessionId);
		this.sessions.delete(sessionId);
		await entry.browser.close();
		await this.provider.closeSession(entry.providerSessionId);
	}

	async dispose(): Promise<void> {
		const sessionIds = [...this.sessions.keys()];
		for (const sessionId of sessionIds) {
			await this.closeSession(sessionId);
		}
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
}
