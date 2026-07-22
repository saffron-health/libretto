import * as errore from "errore";

export class AuthProfileError extends errore.createTaggedError({
	name: "AuthProfileError",
	message: "$message $recovery",
}) {}

export type CreateBrowserSessionOptions = {
	authProfile?: string;
}

/**
 * Every provider reduces to "produce a CDP endpoint"; the session registry
 * connects Playwright to it. Provider-specific settings (API keys, regions)
 * live in each provider's constructor, with env-var fallback.
 */
export type BrowserProvider = {
	/** Shown in `status` output, e.g. "local", "kernel". */
	readonly name: string;
	/** Whether this provider can restore and persist named auth profiles. */
	readonly supportsAuthProfiles?: boolean;
	createSession(
		options?: CreateBrowserSessionOptions,
	): Promise<AuthProfileError | ProviderSession>;
	closeSession(sessionId: string): Promise<ProviderSessionClosed>;
}

export type ProviderSession = {
	/** Provider-scoped session identifier. */
	sessionId: string;
	/** CDP websocket endpoint the registry connects Playwright to. */
	cdpEndpoint: string;
	liveViewUrl?: string;
	recordingUrl?: string;
}

export type ProviderSessionClosed = {
	replayUrl?: string;
}
