import { errorMessage } from "../errors.js";
import {
	ProviderCloseError,
	type BrowserProvider,
	type ProviderCloseResult,
	type ProviderSession,
	type ProviderSessionCreateOptions,
} from "../provider.js";

const DEFAULT_STEEL_API_ENDPOINT = "https://api.steel.dev";
const DEFAULT_STEEL_CONNECT_ENDPOINT = "wss://connect.steel.dev";

export type SteelBrowserProviderOptions = {
	apiKey?: string;
	endpoint?: string;
	connectEndpoint?: string;
	useProxy?: boolean;
	solveCaptcha?: boolean;
	timeoutMs?: number;
	inactivityTimeoutMs?: number;
}

type SteelSessionRequest = {
	useProxy?: boolean;
	solveCaptcha?: boolean;
	timeout?: number;
	inactivityTimeout?: number;
	dimensions?: { width: number; height: number };
}

type SteelSessionResponse = {
	id: string;
	sessionViewerUrl?: string;
}

function buildSteelCdpEndpoint(
	connectEndpoint: string,
	apiKey: string,
	sessionId: string,
): string {
	const endpoint = new URL(connectEndpoint);
	endpoint.searchParams.set("apiKey", apiKey);
	endpoint.searchParams.set("sessionId", sessionId);
	return endpoint.toString();
}

export class SteelBrowserProvider implements BrowserProvider {
	readonly name = "steel";
	private readonly apiKey: string;
	private readonly endpoint: string;
	private readonly connectEndpoint: string;
	private readonly useProxy: boolean | undefined;
	private readonly solveCaptcha: boolean | undefined;
	private readonly timeoutMs: number | undefined;
	private readonly inactivityTimeoutMs: number | undefined;

	constructor(options: SteelBrowserProviderOptions = {}) {
		const apiKey = (options.apiKey ?? process.env.STEEL_API_KEY)?.trim();
		if (!apiKey) {
			throw new Error(
				"SteelBrowserProvider: missing API key. " +
					"Pass new SteelBrowserProvider({ apiKey }) or set STEEL_API_KEY.",
			);
		}

		this.apiKey = apiKey;
		this.endpoint = (
			options.endpoint ??
			process.env.STEEL_BASE_URL?.trim() ??
			DEFAULT_STEEL_API_ENDPOINT
		).replace(/\/$/, "");
		this.connectEndpoint =
			options.connectEndpoint ??
			process.env.STEEL_CONNECT_URL?.trim() ??
			DEFAULT_STEEL_CONNECT_ENDPOINT;
		this.useProxy = options.useProxy;
		this.solveCaptcha = options.solveCaptcha;
		this.timeoutMs = options.timeoutMs;
		this.inactivityTimeoutMs = options.inactivityTimeoutMs;
	}

	async createSession(
		options: ProviderSessionCreateOptions = {},
	): Promise<ProviderSession> {
		// Steel has no create-time start URL; callers should navigate after
		// connect when startUrl is set. Viewport maps to dimensions.
		const viewport = options.viewport;
		const request: SteelSessionRequest = {
			...(this.useProxy === undefined ? {} : { useProxy: this.useProxy }),
			...(this.solveCaptcha === undefined
				? {}
				: { solveCaptcha: this.solveCaptcha }),
			...(this.timeoutMs === undefined ? {} : { timeout: this.timeoutMs }),
			...(this.inactivityTimeoutMs === undefined
				? {}
				: { inactivityTimeout: this.inactivityTimeoutMs }),
			...(viewport
				? {
						dimensions: {
							width: viewport.width,
							height: viewport.height,
						},
					}
				: {}),
		};
		const response = await fetch(`${this.endpoint}/v1/sessions`, {
			method: "POST",
			headers: {
				"steel-api-key": this.apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(request),
		});
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Steel API error (${response.status}): ${body}`);
		}
		const session = (await response.json()) as SteelSessionResponse;
		return {
			sessionId: session.id,
			cdpEndpoint: buildSteelCdpEndpoint(
				this.connectEndpoint,
				this.apiKey,
				session.id,
			),
			liveViewUrl: session.sessionViewerUrl,
			startUrlPreloaded: false,
		};
	}

	async closeSession(sessionId: string): Promise<ProviderCloseResult> {
		const response = await fetch(
			`${this.endpoint}/v1/sessions/${sessionId}/release`,
			{
				method: "POST",
				headers: {
					"steel-api-key": this.apiKey,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			},
		).catch(
			(cause: unknown) =>
				new ProviderCloseError({
					provider: this.name,
					providerSessionId: sessionId,
					detail: errorMessage(cause),
					recovery: "Release the session in the Steel dashboard.",
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
				detail: `Steel API error (${response.status}): ${body}`,
				recovery: "Release the session in the Steel dashboard.",
			});
		}
		return {};
	}
}
