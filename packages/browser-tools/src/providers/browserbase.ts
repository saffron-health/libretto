import type { Browser } from "playwright";
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

export type BrowserbaseBrowserProviderOptions = {
	apiKey?: string;
	projectId?: string;
	endpoint?: string;
	proxies?: boolean;
	solveCaptchas?: boolean;
	timeoutSeconds?: number;
}

type BrowserbaseSessionResponse = {
	id: string;
	connectUrl: string;
}

type BrowserbaseSessionRequest = {
	projectId?: string;
	proxies?: boolean;
	timeout?: number;
	browserSettings?: {
		solveCaptchas?: boolean;
		viewport?: { width: number; height: number };
	};
}

export class BrowserbaseBrowserProvider implements BrowserProvider {
	readonly name = "browserbase";
	private readonly apiKey: string;
	private readonly projectId: string | undefined;
	private readonly endpoint: string;
	private readonly proxies: boolean | undefined;
	private readonly solveCaptchas: boolean | undefined;
	private readonly timeoutSeconds: number | undefined;
	private readonly browsers = new Map<string, Browser>();

	constructor(options: BrowserbaseBrowserProviderOptions = {}) {
		const apiKey = (
			options.apiKey ?? process.env.BROWSERBASE_API_KEY
		)?.trim();
		if (!apiKey) {
			throw new Error(
				"BrowserbaseBrowserProvider: missing API key. " +
					"Pass new BrowserbaseBrowserProvider({ apiKey }) or set BROWSERBASE_API_KEY.",
			);
		}

		this.apiKey = apiKey;
		this.projectId = (
			options.projectId ?? process.env.BROWSERBASE_PROJECT_ID
		)?.trim();
		this.endpoint = (
			options.endpoint ??
			process.env.BROWSERBASE_ENDPOINT?.trim() ??
			"https://api.browserbase.com"
		).replace(/\/$/, "");
		this.proxies = options.proxies;
		this.solveCaptchas = options.solveCaptchas;
		this.timeoutSeconds = options.timeoutSeconds;
	}

	async createSession(
		options: ProviderSessionCreateOptions = {},
	): Promise<ProviderSession> {
		// Browserbase has no create-time start URL; callers should navigate after
		// connect when startUrl is set. Viewport is forwarded via browserSettings.
		const viewport = options.viewport;
		const browserSettings = {
			...(this.solveCaptchas === undefined
				? {}
				: { solveCaptchas: this.solveCaptchas }),
			...(viewport
				? {
						viewport: {
							width: viewport.width,
							height: viewport.height,
						},
					}
				: {}),
		};
		const request: BrowserbaseSessionRequest = {
			...(this.projectId ? { projectId: this.projectId } : {}),
			...(this.proxies === undefined ? {} : { proxies: this.proxies }),
			...(this.timeoutSeconds === undefined
				? {}
				: { timeout: this.timeoutSeconds }),
			...(Object.keys(browserSettings).length > 0 ? { browserSettings } : {}),
		};
		const response = await fetch(`${this.endpoint}/v1/sessions`, {
			method: "POST",
			headers: {
				"X-BB-API-Key": this.apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(request),
		});
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Browserbase API error (${response.status}): ${body}`);
		}
		const session = (await response.json()) as BrowserbaseSessionResponse;
		try {
			const { browser, page } = await connectProviderPage(session.connectUrl);
			const providerSession: ProviderSession = {
				sessionId: session.id,
				page,
				startUrlPreloaded: false,
			};
			this.browsers.set(session.id, browser);
			setProviderSessionCdpEndpoint(providerSession, session.connectUrl);
			return providerSession;
		} catch (error) {
			await this.releaseSession(session.id).catch(() => {});
			throw error;
		}
	}

	async closeSession(sessionId: string): Promise<ProviderSessionClosed> {
		const browser = this.browsers.get(sessionId);
		if (!browser) return {};
		this.browsers.delete(sessionId);
		await closeProviderBrowser(browser, () => this.releaseSession(sessionId));
		return {};
	}

	private async releaseSession(sessionId: string): Promise<void> {
		const response = await fetch(
			`${this.endpoint}/v1/sessions/${sessionId}`,
			{
				method: "POST",
				headers: {
					"X-BB-API-Key": this.apiKey,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ status: "REQUEST_RELEASE" }),
			},
		);
		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`Browserbase API error closing session ${sessionId} (${response.status}): ${body}`,
			);
		}
	}
}
