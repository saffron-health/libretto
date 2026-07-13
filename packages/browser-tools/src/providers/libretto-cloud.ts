import type {
	BrowserProvider,
	ProviderSession,
	ProviderSessionClosed,
} from "../provider.js";

const DEFAULT_HOSTED_API_URL = "https://api.libretto.sh";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_BROWSER_SESSION_TIMEOUT_SECONDS = 3_600;
const QUEUE_WAIT_TIMEOUT_MS = 10 * 60_000;

export type LibrettoCloudBrowserProviderOptions = {
	apiKey?: string;
	apiUrl?: string;
	/** Browser session TTL requested at create time. */
	timeoutSeconds?: number;
	headless?: boolean;
}

type CloudSessionResponse = {
	session_id: string;
	status: string;
	cdp_url: string | null;
	live_view_url: string | null;
}

async function cloudFetchJson<T>(
	endpoint: string,
	apiKey: string,
	path: string,
	body: unknown,
): Promise<T> {
	const response = await fetch(`${endpoint}${path}`, {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ json: body }),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Libretto Cloud API error (${response.status}): ${text}`);
	}
	const payload = (await response.json()) as { json: T };
	return payload.json;
}

async function cloudFetchOk(
	endpoint: string,
	apiKey: string,
	path: string,
	body: unknown,
): Promise<void> {
	const response = await fetch(`${endpoint}${path}`, {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ json: body }),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Libretto Cloud API error (${response.status}): ${text}`);
	}
}

async function waitForCloudSessionReady(args: {
	endpoint: string;
	apiKey: string;
	session: CloudSessionResponse;
}): Promise<CloudSessionResponse & { cdp_url: string }> {
	let session = args.session;
	if (session.cdp_url) {
		return { ...session, cdp_url: session.cdp_url };
	}

	const deadline = Date.now() + QUEUE_WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
		session = await cloudFetchJson<CloudSessionResponse>(
			args.endpoint,
			args.apiKey,
			"/v1/sessions/get",
			{ session_id: session.session_id },
		);
		if (session.cdp_url) {
			return { ...session, cdp_url: session.cdp_url };
		}
		if (!["queued", "starting"].includes(session.status)) {
			throw new Error(
				`Libretto Cloud session ${session.session_id} entered status "${session.status}" before a CDP URL was available.`,
			);
		}
	}

	throw new Error(
		`Timed out waiting for Libretto Cloud browser capacity after ${QUEUE_WAIT_TIMEOUT_MS / 1_000}s (session: ${session.session_id}).`,
	);
}

/**
 * Libretto Cloud browser sessions. The hosted API is an oRPC RPCHandler, so
 * request bodies are wrapped as `{ json: ... }` and responses unwrap the same.
 */
export class LibrettoCloudBrowserProvider implements BrowserProvider {
	readonly name = "libretto-cloud";
	private readonly apiKey: string;
	private readonly endpoint: string;
	private readonly timeoutSeconds: number;
	private readonly headless: boolean;

	constructor(options: LibrettoCloudBrowserProviderOptions = {}) {
		const apiKey = (options.apiKey ?? process.env.LIBRETTO_API_KEY)?.trim();
		if (!apiKey) {
			throw new Error(
				"LibrettoCloudBrowserProvider: missing API key. " +
					"Pass new LibrettoCloudBrowserProvider({ apiKey }) or set LIBRETTO_API_KEY.",
			);
		}

		this.apiKey = apiKey;
		this.endpoint = (
			options.apiUrl ??
			process.env.LIBRETTO_API_URL?.trim() ??
			DEFAULT_HOSTED_API_URL
		).replace(/\/$/, "");
		this.timeoutSeconds =
			options.timeoutSeconds ??
			(Number(process.env.LIBRETTO_TIMEOUT_SECONDS) ||
				DEFAULT_BROWSER_SESSION_TIMEOUT_SECONDS);
		this.headless = options.headless ?? true;
	}

	async createSession(): Promise<ProviderSession> {
		const created = await cloudFetchJson<CloudSessionResponse>(
			this.endpoint,
			this.apiKey,
			"/v1/sessions/create",
			{
				timeout_seconds: this.timeoutSeconds,
				headless: this.headless,
			},
		);

		let ready: CloudSessionResponse & { cdp_url: string };
		try {
			ready = await waitForCloudSessionReady({
				endpoint: this.endpoint,
				apiKey: this.apiKey,
				session: created,
			});
		} catch (error) {
			await cloudFetchOk(this.endpoint, this.apiKey, "/v1/sessions/close", {
				session_id: created.session_id,
			}).catch(() => {});
			throw error;
		}

		return {
			sessionId: ready.session_id,
			cdpEndpoint: ready.cdp_url,
			liveViewUrl: ready.live_view_url ?? undefined,
		};
	}

	async closeSession(sessionId: string): Promise<ProviderSessionClosed> {
		await cloudFetchOk(this.endpoint, this.apiKey, "/v1/sessions/close", {
			session_id: sessionId,
		});

		let replayUrl: string | undefined;
		try {
			const recording = await cloudFetchJson<{
				recording_url: string | null;
			}>(this.endpoint, this.apiKey, "/v1/recordings/get", {
				session_id: sessionId,
			});
			replayUrl = recording.recording_url ?? undefined;
		} catch {
			// Recording may not exist yet; closing the session still succeeded.
		}

		return { replayUrl };
	}
}
