import { errorMessage } from "../errors.js";
import {
	ProviderCloseError,
	type BrowserProvider,
	type ProviderCloseResult,
	type ProviderSession,
	type ProviderSessionCreateOptions,
} from "../provider.js";

const DEFAULT_BROWSER_USE_ENDPOINT = "https://api.browser-use.com/api/v3";

export type BrowserUseBrowserProviderOptions = {
	apiKey?: string;
	endpoint?: string;
	proxyCountryCode?: string | null;
	timeoutMinutes?: number;
}

type BrowserUseSessionResponse = {
	id: string;
	cdpUrl?: string | null;
	liveUrl?: string | null;
}

function normalizeCdpEndpoint(cdpUrl: string): string {
	const endpoint = new URL(cdpUrl);
	if (endpoint.protocol === "https:") endpoint.protocol = "wss:";
	if (endpoint.protocol === "http:") endpoint.protocol = "ws:";
	return endpoint.toString();
}

export class BrowserUseBrowserProvider implements BrowserProvider {
	readonly name = "browser-use";
	private readonly apiKey: string;
	private readonly endpoint: string;
	private readonly proxyCountryCode: string | null | undefined;
	private readonly timeoutMinutes: number | undefined;

	constructor(options: BrowserUseBrowserProviderOptions = {}) {
		const apiKey = (
			options.apiKey ?? process.env.BROWSER_USE_API_KEY
		)?.trim();
		if (!apiKey) {
			throw new Error(
				"BrowserUseBrowserProvider: missing API key. " +
					"Pass new BrowserUseBrowserProvider({ apiKey }) or set BROWSER_USE_API_KEY.",
			);
		}

		this.apiKey = apiKey;
		this.endpoint = (
			options.endpoint ??
			process.env.BROWSER_USE_BASE_URL?.trim() ??
			DEFAULT_BROWSER_USE_ENDPOINT
		).replace(/\/$/, "");
		this.proxyCountryCode = options.proxyCountryCode;
		this.timeoutMinutes = options.timeoutMinutes;
	}

	async createSession(
		_options: ProviderSessionCreateOptions = {},
	): Promise<ProviderSession> {
		const response = await fetch(`${this.endpoint}/browsers`, {
			method: "POST",
			headers: {
				"X-Browser-Use-API-Key": this.apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				...(this.proxyCountryCode === undefined
					? {}
					: { proxyCountryCode: this.proxyCountryCode }),
				...(this.timeoutMinutes === undefined
					? {}
					: { timeout: this.timeoutMinutes }),
			}),
		});
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Browser Use API error (${response.status}): ${body}`);
		}

		const session = (await response.json()) as BrowserUseSessionResponse;
		if (!session.cdpUrl) {
			const createError = new Error(
				`Browser Use session ${session.id} did not return a CDP URL. Stop the session in the Browser Use dashboard, then create a fresh session.`,
			);
			const closeError = await this.closeSession(session.id);
			if (closeError instanceof Error) {
				throw new AggregateError(
					[createError, closeError],
					"Browser Use session creation and cleanup both failed.",
				);
			}
			throw createError;
		}
		return {
			sessionId: session.id,
			cdpEndpoint: normalizeCdpEndpoint(session.cdpUrl),
			...(session.liveUrl ? { liveViewUrl: session.liveUrl } : {}),
			startUrlPreloaded: false,
		};
	}

	async closeSession(sessionId: string): Promise<ProviderCloseResult> {
		const response = await fetch(`${this.endpoint}/browsers/${sessionId}`, {
			method: "PATCH",
			headers: {
				"X-Browser-Use-API-Key": this.apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ action: "stop" }),
		}).catch(
			(cause: unknown) =>
				new ProviderCloseError({
					provider: this.name,
					providerSessionId: sessionId,
					detail: errorMessage(cause),
					recovery: "Stop the session in the Browser Use dashboard.",
					cause,
				}),
		);
		if (response instanceof Error) return response;
		if (!response.ok) {
			const body = await response
				.text()
				.catch((cause: unknown) => errorMessage(cause));
			return new ProviderCloseError({
				provider: this.name,
				providerSessionId: sessionId,
				detail: `Browser Use API error (${response.status}): ${body}`,
				recovery: "Stop the session in the Browser Use dashboard.",
			});
		}
		return {};
	}
}
