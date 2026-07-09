import type {
	BrowserProvider,
	ProviderSession,
	ProviderSessionClosed,
} from "../provider.js";

export interface KernelBrowserProviderOptions {
	apiKey?: string;
	headless?: boolean;
	stealth?: boolean;
	timeoutSeconds?: number;
	enableRecording?: boolean;
}

interface KernelBrowserResponse {
	session_id: string;
	cdp_ws_url: string;
	browser_live_view_url?: string | null;
}

interface KernelReplayResponse {
	replay_id: string;
	replay_view_url?: string | null;
}

interface KernelReplay {
	replayId: string;
	replayViewUrl?: string;
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
	private readonly replays = new Map<string, KernelReplay>();

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
		this.timeoutSeconds =
			options.timeoutSeconds ??
			Number(process.env.KERNEL_TIMEOUT_SECONDS ?? 300);
		this.enableRecording =
			options.enableRecording ??
			readBooleanEnv("KERNEL_ENABLE_RECORDING", false);
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
				this.replays.set(browser.session_id, {
					replayId: replay.replay_id,
					replayViewUrl: replay.replay_view_url ?? undefined,
				});
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
		const replay = this.replays.get(sessionId);
		let replayStopError: unknown;
		if (replay) {
			try {
				await kernelFetchNoBody(
					this.endpoint,
					this.apiKey,
					`/browsers/${sessionId}/replays/${replay.replayId}/stop`,
					{ method: "POST" },
				);
			} catch (error) {
				replayStopError = error;
			}
		}

		await kernelFetchNoBody(
			this.endpoint,
			this.apiKey,
			`/browsers/${sessionId}`,
			{ method: "DELETE" },
		);
		this.replays.delete(sessionId);

		if (replayStopError) throw replayStopError;
		return { replayUrl: replay?.replayViewUrl };
	}
}
