/**
 * Every provider reduces to "produce a CDP endpoint"; the session registry
 * connects Playwright to it. Provider-specific settings (API keys, regions)
 * live in each provider's constructor, with env-var fallback.
 */
export interface BrowserProvider {
	/** Shown in `status` output, e.g. "local", "kernel". */
	readonly name: string;
	createSession(): Promise<ProviderSession>;
	closeSession(sessionId: string): Promise<ProviderSessionClosed>;
}

export interface ProviderSession {
	/** Provider-scoped session identifier. */
	sessionId: string;
	/** CDP websocket endpoint the registry connects Playwright to. */
	cdpEndpoint: string;
	liveViewUrl?: string;
	recordingUrl?: string;
}

export interface ProviderSessionClosed {
	replayUrl?: string;
}
