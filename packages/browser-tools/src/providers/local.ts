import { createServer } from "node:net";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import { errorMessage } from "../errors.js";
import {
	ProviderCloseError,
	type BrowserProvider,
	type ProviderCloseResult,
	type ProviderSession,
	type ProviderSessionCreateOptions,
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
 * Launches a local Chromium with an ephemeral remote-debugging port and hands
 * back its CDP websocket endpoint. This is the only provider that needs the
 * Chromium binary installed (`npx playwright install chromium`); cloud
 * providers attach over CDP without a local browser download.
 */
export class LocalBrowserProvider implements BrowserProvider {
	readonly name = "local";
	private readonly channel: string | undefined;
	private readonly headless: boolean;
	private readonly browsers = new Map<string, Browser>();
	private nextSessionNumber = 1;

	constructor(options: LocalBrowserProviderOptions = {}) {
		this.channel = options.channel;
		this.headless = options.headless ?? false;
	}

	async createSession(
		_options: ProviderSessionCreateOptions = {},
	): Promise<ProviderSession> {
		const port = await pickFreePort();
		const browser = await chromium.launch({
			...(this.channel ? { channel: this.channel } : {}),
			headless: this.headless,
			args: [`--remote-debugging-port=${port}`],
		});
		const sessionId = `local-${this.nextSessionNumber++}`;
		this.browsers.set(sessionId, browser);
		const cdpEndpoint = await fetchWebSocketDebuggerUrl(port).catch(
			async (createError: unknown) => {
				const closeError = await this.closeSession(sessionId);
				if (closeError instanceof Error) {
					throw new AggregateError(
						[createError, closeError],
						"Local browser creation and cleanup both failed.",
					);
				}
				throw createError;
			},
		);
		return { sessionId, cdpEndpoint, startUrlPreloaded: false };
	}

	async closeSession(sessionId: string): Promise<ProviderCloseResult> {
		const browser = this.browsers.get(sessionId);
		if (!browser) return {};
		const closed = await browser.close().catch(
			(cause: unknown) =>
				new ProviderCloseError({
					provider: this.name,
					providerSessionId: sessionId,
					detail: errorMessage(cause),
					recovery:
						"Call closeSession again; if it still fails, stop the local Chromium process.",
					cause,
				}),
		);
		if (closed instanceof Error) return closed;
		this.browsers.delete(sessionId);
		return {};
	}
}
