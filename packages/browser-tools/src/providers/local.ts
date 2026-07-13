import { createServer } from "node:net";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import type {
	BrowserProvider,
	ProviderSession,
	ProviderSessionClosed,
} from "../provider.js";

export type LocalBrowserProviderOptions = {
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
	private readonly headless: boolean;
	private readonly browsers = new Map<string, Browser>();
	private nextSessionNumber = 1;

	constructor(options: LocalBrowserProviderOptions = {}) {
		this.headless = options.headless ?? false;
	}

	async createSession(): Promise<ProviderSession> {
		const port = await pickFreePort();
		const browser = await chromium.launch({
			headless: this.headless,
			args: [`--remote-debugging-port=${port}`],
		});
		const cdpEndpoint = await fetchWebSocketDebuggerUrl(port);
		const sessionId = `local-${this.nextSessionNumber++}`;
		this.browsers.set(sessionId, browser);
		return { sessionId, cdpEndpoint };
	}

	async closeSession(sessionId: string): Promise<ProviderSessionClosed> {
		const browser = this.browsers.get(sessionId);
		if (browser) {
			this.browsers.delete(sessionId);
			await browser.close();
		}
		return {};
	}
}
