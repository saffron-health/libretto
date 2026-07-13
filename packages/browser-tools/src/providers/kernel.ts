import type {
	BrowserProvider,
	ProviderSession,
	ProviderSessionClosed,
} from "../provider.js";

export type KernelBrowserProviderOptions = {
	apiKey?: string;
	headless?: boolean;
	stealth?: boolean;
	timeoutSeconds?: number;
	enableRecording?: boolean;
}

type KernelBrowserResponse = {
	session_id: string;
	cdp_ws_url: string;
	browser_live_view_url?: string | null;
}

type KernelReplayResponse = {
	replay_view_url?: string | null;
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
	const value = process.env[name]?.trim().toLowerCase();
	if (!value) return defaultValue;
	if (value === "1" || value === "true" || value === "yes") return true;
	if (value === "0" || value === "false" || value === "no") return false;
	return defaultValue;
}

function readEndpoint(): string {
	return (
		process.env.KERNEL_API_ENDPOINT?.trim() ||
		process.env.KERNEL_ENDPOINT?.trim() ||
		"https://api.onkernel.com"
	);
}

function readTimeoutSeconds(option: number | undefined): number {
	const timeoutSeconds =
		option ?? Number(process.env.KERNEL_TIMEOUT_SECONDS ?? 300);
	if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
		throw new Error(
			"KernelBrowserProvider: timeout must be a positive number of seconds. " +
				"Pass { timeoutSeconds } or set KERNEL_TIMEOUT_SECONDS.",
		);
	}
	return timeoutSeconds;
}

async function kernelFetchJson<T>(
	endpoint: string,
	apiKey: string,
	path: string,
	init: RequestInit,
): Promise<T> {
	const response = await fetch(`${endpoint}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			...init.headers,
		},
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Kernel API error (${response.status}): ${body}`);
	}
	return (await response.json()) as T;
}

async function kernelFetchNoBody(
	endpoint: string,
	apiKey: string,
	path: string,
	init: RequestInit,
): Promise<void> {
	const response = await fetch(`${endpoint}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			...init.headers,
		},
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Kernel API error (${response.status}): ${body}`);
	}
}

export class KernelBrowserProvider implements BrowserProvider {
	readonly name = "kernel";
	private readonly apiKey: string;
	private readonly endpoint: string;
	private readonly headless: boolean;
	private readonly stealth: boolean;
	private readonly timeoutSeconds: number;
	private readonly enableRecording: boolean;
	private readonly replayUrlBySession = new Map<string, string>();

	constructor(options: KernelBrowserProviderOptions = {}) {
		const apiKey = (options.apiKey ?? process.env.KERNEL_API_KEY)?.trim();
		if (!apiKey) {
			throw new Error(
				"KernelBrowserProvider: missing API key. " +
					"Pass new KernelBrowserProvider({ apiKey }) or set KERNEL_API_KEY.",
			);
		}

		this.apiKey = apiKey;
		this.endpoint = readEndpoint();
		this.headless =
			options.headless ?? readBooleanEnv("KERNEL_HEADLESS", true);
		this.stealth = options.stealth ?? readBooleanEnv("KERNEL_STEALTH", false);
		this.timeoutSeconds = readTimeoutSeconds(options.timeoutSeconds);
		this.enableRecording =
			options.enableRecording ??
			readBooleanEnv("KERNEL_ENABLE_RECORDING", false);
		if (this.enableRecording && this.headless) {
			throw new Error(
				"KernelBrowserProvider: replays require a headed browser. " +
					"Pass { headless: false } or set KERNEL_HEADLESS=false.",
			);
		}
	}

	async createSession(): Promise<ProviderSession> {
		const browser = await kernelFetchJson<KernelBrowserResponse>(
			this.endpoint,
			this.apiKey,
			"/browsers",
			{
				method: "POST",
				body: JSON.stringify({
					headless: this.headless,
					stealth: this.stealth,
					timeout_seconds: this.timeoutSeconds,
				}),
			},
		);

		let replay: KernelReplayResponse | undefined;
		if (this.enableRecording) {
			try {
				replay = await kernelFetchJson<KernelReplayResponse>(
					this.endpoint,
					this.apiKey,
					`/browsers/${browser.session_id}/replays`,
					{ method: "POST", body: JSON.stringify({}) },
				);
				if (replay.replay_view_url) {
					this.replayUrlBySession.set(
						browser.session_id,
						replay.replay_view_url,
					);
				}
			} catch (error) {
				await kernelFetchNoBody(
					this.endpoint,
					this.apiKey,
					`/browsers/${browser.session_id}`,
					{ method: "DELETE" },
				).catch(() => {});
				throw error;
			}
		}

		return {
			sessionId: browser.session_id,
			cdpEndpoint: browser.cdp_ws_url,
			liveViewUrl: browser.browser_live_view_url ?? undefined,
			recordingUrl: replay?.replay_view_url ?? undefined,
		};
	}

	async closeSession(sessionId: string): Promise<ProviderSessionClosed> {
		const replayUrl = this.replayUrlBySession.get(sessionId);

		await kernelFetchNoBody(
			this.endpoint,
			this.apiKey,
			`/browsers/${sessionId}`,
			{ method: "DELETE" },
		);
		this.replayUrlBySession.delete(sessionId);

		return { replayUrl };
	}
}
