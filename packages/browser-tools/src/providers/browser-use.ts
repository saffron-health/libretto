import { errorMessage } from "../errors.js";
import {
	AuthProfileError,
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

type BrowserUseProfile = {
	id: string;
	name?: string | null;
}

type BrowserUseProfileListResponse = {
	items: BrowserUseProfile[];
	totalItems: number;
	pageNumber: number;
	pageSize: number;
}

const PROFILE_PAGE_SIZE = 100;
// The stop endpoint returns before profile state is reusable and exposes no save status.
const PROFILE_SAVE_WAIT_MS = 5_000;

function normalizeCdpEndpoint(cdpUrl: string): string {
	const endpoint = new URL(cdpUrl);
	if (endpoint.protocol === "https:") endpoint.protocol = "wss:";
	if (endpoint.protocol === "http:") endpoint.protocol = "ws:";
	return endpoint.toString();
}

export class BrowserUseBrowserProvider implements BrowserProvider {
	readonly name = "browser-use";
	readonly supportsAuthProfiles = true;
	private readonly apiKey: string;
	private readonly endpoint: string;
	private readonly proxyCountryCode: string | null | undefined;
	private readonly timeoutMinutes: number | undefined;
	private readonly profiledSessions = new Set<string>();

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
		options: ProviderSessionCreateOptions = {},
	): Promise<AuthProfileError | ProviderSession> {
		const profile = options.authProfile
			? await this.findOrCreateProfile(options.authProfile).catch(
					(cause: unknown) =>
						new AuthProfileError({
							message: `Could not resolve Browser Use auth profile "${options.authProfile}": ${errorMessage(cause)}.`,
							recovery:
								"Check the Browser Use API key, billing and profile limits, and service status, then retry browser_open. To continue without saved state, omit authProfile.",
						}),
				)
			: undefined;
		if (profile instanceof AuthProfileError) return profile;

		const response = await fetch(`${this.endpoint}/browsers`, {
			method: "POST",
			headers: {
				"X-Browser-Use-API-Key": this.apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				...(profile ? { profileId: profile.id } : {}),
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
			if (profile) this.profiledSessions.add(session.id);
		return {
			sessionId: session.id,
			cdpEndpoint: normalizeCdpEndpoint(session.cdpUrl),
			...(session.liveUrl ? { liveViewUrl: session.liveUrl } : {}),
			startUrlPreloaded: false,
		};
	}

	private async findOrCreateProfile(
		profileName: string,
	): Promise<AuthProfileError | BrowserUseProfile> {
		const exactMatches: BrowserUseProfile[] = [];
		let pageNumber = 1;

		while (true) {
			const query = new URLSearchParams({
				query: profileName,
				pageSize: String(PROFILE_PAGE_SIZE),
				pageNumber: String(pageNumber),
			});
			const profiles = await this.fetchJson<BrowserUseProfileListResponse>(
				`/profiles?${query.toString()}`,
			);
			exactMatches.push(
				...profiles.items.filter((profile) => profile.name === profileName),
			);

			if (profiles.pageNumber * profiles.pageSize >= profiles.totalItems) break;
			pageNumber += 1;
		}

		if (exactMatches.length > 1) {
			return new AuthProfileError({
				message: `Found multiple Browser Use auth profiles named "${profileName}".`,
				recovery:
					"Rename or delete the duplicate profiles in the Browser Use dashboard, then retry.",
			});
		}
		if (exactMatches[0]) return exactMatches[0];

		return await this.fetchJson<BrowserUseProfile>("/profiles", {
			method: "POST",
			body: JSON.stringify({ name: profileName }),
		});
	}

	private async fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`${this.endpoint}${path}`, {
			...init,
			headers: {
				"X-Browser-Use-API-Key": this.apiKey,
				"Content-Type": "application/json",
				...init.headers,
			},
		});
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Browser Use API error (${response.status}): ${body}`);
		}
		return (await response.json()) as T;
	}

	async closeSession(sessionId: string): Promise<ProviderCloseResult> {
		const hadProfile = this.profiledSessions.delete(sessionId);
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
		if (hadProfile) {
			await new Promise((resolve) => setTimeout(resolve, PROFILE_SAVE_WAIT_MS));
		}
		return {};
	}
}
