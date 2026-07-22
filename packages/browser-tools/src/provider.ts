/**
 * Every provider reduces to "produce a CDP endpoint"; the session registry
 * connects Playwright to it. Provider-level settings (API keys, regions,
 * default headless/stealth) live in each provider's constructor, with env-var
 * fallback. Per-session launch options go on createSession.
 */
export type ProviderSessionCreateOptions = {
	startUrl?: string;
	gpu?: boolean;
	viewport?: { width: number; height: number };
}

export type BrowserProvider = {
	/** Shown in `status` output, e.g. "local", "kernel". */
	readonly name: string;
	createSession(
		options?: ProviderSessionCreateOptions,
	): Promise<ProviderSession>;
	closeSession(sessionId: string): Promise<ProviderSessionClosed>;
}

export type ProviderSession = {
	/** Provider-scoped session identifier. */
	sessionId: string;
	/** CDP websocket endpoint the registry connects Playwright to. */
	cdpEndpoint: string;
	liveViewUrl?: string;
	recordingUrl?: string;
	/**
	 * True when the provider opened startUrl before CDP attach. Callers should
	 * not navigate again with page.goto in that case.
	 */
	startUrlPreloaded?: boolean;
}

export type ProviderSessionClosed = {
	replayUrl?: string;
}
