import type {
	BrowserProvider,
	ProviderSession,
	ProviderSessionClosed,
} from "../provider.js";

export type BrowserbaseBrowserProviderOptions = {
	apiKey?: string;
	projectId?: string;
	endpoint?: string;
}

type BrowserbaseSessionResponse = {
	id: string;
	connectUrl: string;
}

export class BrowserbaseBrowserProvider implements BrowserProvider {
	readonly name = "browserbase";
	private readonly apiKey: string;
	private readonly projectId: string;
	private readonly endpoint: string;

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

		const projectId = (
			options.projectId ?? process.env.BROWSERBASE_PROJECT_ID
		)?.trim();
		if (!projectId) {
			throw new Error(
				"BrowserbaseBrowserProvider: missing project ID. " +
					"Pass new BrowserbaseBrowserProvider({ projectId }) or set BROWSERBASE_PROJECT_ID.",
			);
		}

		this.apiKey = apiKey;
		this.projectId = projectId;
		this.endpoint = (
			options.endpoint ??
			process.env.BROWSERBASE_ENDPOINT?.trim() ??
			"https://api.browserbase.com"
		).replace(/\/$/, "");
	}

	async createSession(): Promise<ProviderSession> {
		const response = await fetch(`${this.endpoint}/v1/sessions`, {
			method: "POST",
			headers: {
				"X-BB-API-Key": this.apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ projectId: this.projectId }),
		});
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Browserbase API error (${response.status}): ${body}`);
		}
		const session = (await response.json()) as BrowserbaseSessionResponse;
		return {
			sessionId: session.id,
			cdpEndpoint: session.connectUrl,
		};
	}

	async closeSession(sessionId: string): Promise<ProviderSessionClosed> {
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
		return {};
	}
}
