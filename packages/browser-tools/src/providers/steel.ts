import type {
	BrowserProvider,
	ProviderSession,
	ProviderSessionClosed,
} from "../provider.js";

const DEFAULT_STEEL_API_ENDPOINT = "https://api.steel.dev";
const DEFAULT_STEEL_CONNECT_ENDPOINT = "wss://connect.steel.dev";

export type SteelBrowserProviderOptions = {
	apiKey?: string;
	endpoint?: string;
	connectEndpoint?: string;
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
	}

	async createSession(): Promise<ProviderSession> {
		const response = await fetch(`${this.endpoint}/v1/sessions`, {
			method: "POST",
			headers: {
				"steel-api-key": this.apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({}),
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
		};
	}

	async closeSession(sessionId: string): Promise<ProviderSessionClosed> {
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
		);
		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`Steel API error closing session ${sessionId} (${response.status}): ${body}`,
			);
		}
		return {};
	}
}
