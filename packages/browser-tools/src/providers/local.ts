import { createServer } from "node:net";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import type {
	BrowserProvider,
	ProviderSession,
	ProviderSessionClosed,
	ProviderSessionCreateOptions,
} from "../provider.js";
import {
	closeProviderBrowser,
	connectProviderPage,
	setProviderSessionCdpEndpoint,
} from "../provider.js";

export type LocalBrowserProviderOptions = {
	channel?: string;
	headless?: boolean;
}

async function pickFreePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (addr && typeof addr === "object") {
				server.close(() => resolve(addr.port));
				return;
			}
			server.close(() => reject(new Error("Failed to resolve debug port")));
		});
	});
}

async function fetchWebSocketDebuggerUrl(port: number): Promise<string> {
	const versionUrl = `http://127.0.0.1:${port}/json/version`;
	const deadline = Date.now() + 10_000;
	// The DevTools HTTP server may come up slightly after launch resolves.
	while (Date.now() < deadline) {
		try {
			const response = await fetch(versionUrl);
			const info = (await response.json()) as {
				webSocketDebuggerUrl?: string;
			};
			if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
		} catch {
			// Not listening yet; retry below.
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Could not read webSocketDebuggerUrl from ${versionUrl}`);
}

/**
 * Launches local Chromium and returns its initial CDP-attached page. This is
 * the only provider that needs a local browser binary.
 */
export class LocalBrowserProvider implements BrowserProvider {
	readonly name = "local";
	private readonly channel: string | undefined;
	private readonly headless: boolean;
	private readonly sessions = new Map<
		string,
		{ browser: Browser; launchedBrowser: Browser }
	>();
	private nextSessionNumber = 1;

	constructor(options: LocalBrowserProviderOptions = {}) {
		this.channel = options.channel;
		this.headless = options.headless ?? false;
	}

	async createSession(
		_options: ProviderSessionCreateOptions = {},
	): Promise<ProviderSession> {
		const port = await pickFreePort();
		const launchedBrowser = await chromium.launch({
			...(this.channel ? { channel: this.channel } : {}),
			headless: this.headless,
			args: [`--remote-debugging-port=${port}`],
		});
		try {
			const cdpEndpoint = await fetchWebSocketDebuggerUrl(port);
			const { browser, page } = await connectProviderPage(cdpEndpoint);
			const sessionId = `local-${this.nextSessionNumber++}`;
			const session: ProviderSession = {
				sessionId,
				page,
				startUrlPreloaded: false,
			};
			this.sessions.set(sessionId, { browser, launchedBrowser });
			setProviderSessionCdpEndpoint(session, cdpEndpoint);
			return session;
		} catch (error) {
			await launchedBrowser.close().catch(() => {});
			throw error;
		}
	}

	async closeSession(sessionId: string): Promise<ProviderSessionClosed> {
		const session = this.sessions.get(sessionId);
		if (!session) return {};
		this.sessions.delete(sessionId);
		await closeProviderBrowser(session.browser, () =>
			session.launchedBrowser.close(),
		);
		return {};
	}
}
