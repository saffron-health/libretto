import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { errorMessage } from "../errors.js";
import {
	ProviderCloseError,
	type BrowserProvider,
	type ProviderCloseResult,
	type ProviderSession,
	type ProviderSessionCreateOptions,
} from "../provider.js";

export type KernelBrowserProviderOptions = {
	apiKey?: string;
	headless?: boolean;
	stealth?: boolean;
	proxyId?: string;
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

const CDP_READY_ATTEMPTS = 3;
const CDP_HANDSHAKE_TIMEOUT_MS = 10_000;

async function cdpHandshakeStatus(cdpEndpoint: string): Promise<number> {
	const url = new URL(cdpEndpoint);
	const request = url.protocol === "wss:" ? httpsRequest : httpRequest;
	url.protocol = url.protocol === "wss:" ? "https:" : "http:";
	return await new Promise((resolve, reject) => {
		const clientRequest = request(url, {
			headers: {
				Connection: "Upgrade",
				"Sec-WebSocket-Key": randomBytes(16).toString("base64"),
				"Sec-WebSocket-Version": "13",
				Upgrade: "websocket",
			},
		});
		clientRequest.once("upgrade", (_response, socket) => {
			socket.destroy();
			resolve(101);
		});
		clientRequest.once("response", (response) => {
			response.resume();
			resolve(response.statusCode ?? 0);
		});
		clientRequest.once("error", reject);
		clientRequest.setTimeout(CDP_HANDSHAKE_TIMEOUT_MS, () => {
			clientRequest.destroy(
				new Error(
					`Kernel CDP WebSocket handshake timed out after ${CDP_HANDSHAKE_TIMEOUT_MS}ms.`,
				),
			);
		});
		clientRequest.end();
	});
}

async function waitForCdpReady(cdpEndpoint: string): Promise<void> {
	for (let attempt = 1; attempt <= CDP_READY_ATTEMPTS; attempt += 1) {
		const status = await cdpHandshakeStatus(cdpEndpoint);
		if (status === 101) return;
		if (status !== 401) {
			throw new Error(
				`Kernel CDP WebSocket handshake failed with HTTP ${status}. Create a fresh browser session and try again.`,
			);
		}
		if (attempt === CDP_READY_ATTEMPTS) {
			throw new Error(
				`Kernel CDP WebSocket rejected its JWT with HTTP 401 after ${CDP_READY_ATTEMPTS} attempts. Create a fresh browser session and try again.`,
			);
		}
		await new Promise((resolve) =>
			setTimeout(resolve, attempt === 1 ? 1_000 : 2_000),
		);
	}
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
	private readonly proxyId: string | undefined;
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
		this.proxyId =
			options.proxyId?.trim() || process.env.KERNEL_PROXY_ID?.trim() || undefined;
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

	async createSession(
		options: ProviderSessionCreateOptions = {},
	): Promise<ProviderSession> {
		const startUrl = options.startUrl?.trim() || undefined;
		const gpu = options.gpu;
		const viewport = options.viewport;
		const browser = await kernelFetchJson<KernelBrowserResponse>(
			this.endpoint,
			this.apiKey,
			"/browsers",
			{
				method: "POST",
				body: JSON.stringify({
					headless: this.headless,
					stealth: this.stealth,
					...(this.proxyId ? { proxy_id: this.proxyId } : {}),
					...(startUrl ? { start_url: startUrl } : {}),
					...(gpu !== undefined ? { gpu } : {}),
					...(viewport
						? {
								viewport: {
									width: viewport.width,
									height: viewport.height,
								},
							}
						: {}),
					timeout_seconds: this.timeoutSeconds,
				}),
			},
		);
		try {
			await waitForCdpReady(browser.cdp_ws_url);
		} catch (error) {
			return this.throwAfterFailedCreateCleanup(browser.session_id, error);
		}

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
				return this.throwAfterFailedCreateCleanup(browser.session_id, error);
			}
		}

		return {
			sessionId: browser.session_id,
			cdpEndpoint: browser.cdp_ws_url,
			liveViewUrl: browser.browser_live_view_url ?? undefined,
			recordingUrl: replay?.replay_view_url ?? undefined,
			startUrlPreloaded: Boolean(startUrl),
		};
	}

	private async throwAfterFailedCreateCleanup(
		sessionId: string,
		createError: unknown,
	): Promise<never> {
		const closeError = await this.closeSession(sessionId);
		if (closeError instanceof Error) {
			throw new AggregateError(
				[createError, closeError],
				"Kernel session creation and cleanup both failed.",
			);
		}
		throw createError;
	}

	async closeSession(sessionId: string): Promise<ProviderCloseResult> {
		const replayUrl = this.replayUrlBySession.get(sessionId);

		const closed = await kernelFetchNoBody(
			this.endpoint,
			this.apiKey,
			`/browsers/${sessionId}`,
			{ method: "DELETE" },
		).catch(
			(cause: unknown) =>
				new ProviderCloseError({
					provider: this.name,
					providerSessionId: sessionId,
					detail: errorMessage(cause),
					recovery:
						"Call closeSession again, or delete the browser in the Kernel dashboard.",
					cause,
				}),
		);
		if (closed instanceof Error) return closed;
		this.replayUrlBySession.delete(sessionId);

		return { replayUrl };
	}
}
