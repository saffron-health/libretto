import { chmod, lstat, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Browser, BrowserContext } from "playwright";
import { chromium } from "playwright";
import { errorMessage } from "../errors.js";
import {
	AuthProfileError,
	ProviderCloseError,
	type BrowserProvider,
	type ProviderCloseResult,
	type ProviderSession,
	type ProviderSessionCreateOptions,
} from "../provider.js";

export type LocalBrowserProviderOptions = {
	authProfileDirectory?: string;
	channel?: string;
	headless?: boolean;
}

type LocalSession = {
	browser: Browser;
	persistentContext: BrowserContext | null;
}

const AUTH_PROFILE_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

async function resolveAuthProfilePath(
	authProfileDirectory: string,
	authProfile: string,
): Promise<AuthProfileError | string> {
	if (
		authProfile === "." ||
		authProfile === ".." ||
		!AUTH_PROFILE_NAME_PATTERN.test(authProfile)
	) {
		return new AuthProfileError({
			message: `Invalid local auth profile name "${authProfile}".`,
			recovery:
				"Use only letters, numbers, dots, underscores, or hyphens in authProfile.",
		});
	}

	const root = resolve(authProfileDirectory);
	const profilePath = resolve(root, authProfile);
	if (dirname(profilePath) !== root) {
		return new AuthProfileError({
			message: `Local auth profile "${authProfile}" escapes the profile directory.`,
			recovery: "Choose an authProfile name without path segments.",
		});
	}

	await mkdir(root, { recursive: true, mode: 0o700 });
	await chmod(root, 0o700);
	const existing = await lstat(profilePath).catch((cause: unknown) => {
		if (
			cause instanceof Error &&
			"code" in cause &&
			cause.code === "ENOENT"
		) {
			return null;
		}
		throw cause;
	});
	if (existing?.isSymbolicLink()) {
		return new AuthProfileError({
			message: `Local auth profile "${authProfile}" is a symbolic link.`,
			recovery:
				"Ask the toolkit developer to remove the link or choose another authProfile.",
		});
	}
	if (existing && !existing.isDirectory()) {
		return new AuthProfileError({
			message: `Local auth profile "${authProfile}" is not a directory.`,
			recovery:
				"Ask the toolkit developer to remove the file or choose another authProfile.",
		});
	}
	if (!existing) await mkdir(profilePath, { mode: 0o700 });
	await chmod(profilePath, 0o700);
	return profilePath;
}

async function pickFreePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (addr && typeof addr === "object") {
				server.close(() => resolve(addr.port));
				return;
			}
			server.close(() => reject(new Error("Failed to resolve debug port")));
		});
	});
}

async function fetchWebSocketDebuggerUrl(port: number): Promise<string> {
	const versionUrl = `http://127.0.0.1:${port}/json/version`;
	const deadline = Date.now() + 10_000;
	// The DevTools HTTP server may come up slightly after launch resolves.
	while (Date.now() < deadline) {
		try {
			const response = await fetch(versionUrl);
			const info = (await response.json()) as {
				webSocketDebuggerUrl?: string;
			};
			if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
		} catch {
			// Not listening yet; retry below.
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Could not read webSocketDebuggerUrl from ${versionUrl}`);
}

/**
 * Launches a local Chromium with an ephemeral remote-debugging port and hands
 * back its CDP websocket endpoint. This is the only provider that needs the
 * Chromium binary installed (`npx playwright install chromium`); cloud
 * providers attach over CDP without a local browser download.
 */
export class LocalBrowserProvider implements BrowserProvider {
	readonly name = "local";
	readonly supportsAuthProfiles = true;
	private readonly authProfileDirectory: string;
	private readonly channel: string | undefined;
	private readonly headless: boolean;
	private readonly sessions = new Map<string, LocalSession>();
	private nextSessionNumber = 1;

	constructor(options: LocalBrowserProviderOptions = {}) {
		this.authProfileDirectory =
			options.authProfileDirectory ??
			join(homedir(), ".libretto", "browser-tools", "profiles");
		this.channel = options.channel;
		this.headless = options.headless ?? false;
	}

	async createSession(
		options: ProviderSessionCreateOptions = {},
	): Promise<AuthProfileError | ProviderSession> {
		const port = await pickFreePort();
		const launchOptions = {
			...(this.channel ? { channel: this.channel } : {}),
			headless: this.headless,
			args: [`--remote-debugging-port=${port}`],
		};
		const authProfilePath =
			options.authProfile === undefined
				? null
				: await resolveAuthProfilePath(
					this.authProfileDirectory,
					options.authProfile,
				);
		if (authProfilePath instanceof Error) return authProfilePath;

		const persistentContext =
			authProfilePath === null
				? null
				: await chromium.launchPersistentContext(
						authProfilePath,
						launchOptions,
					);
		const browser =
			persistentContext === null
				? await chromium.launch(launchOptions)
				: persistentContext.browser();
		if (!browser) {
			await persistentContext?.close();
			throw new Error("Persistent Chromium context has no connected browser.");
		}
		const sessionId = `local-${this.nextSessionNumber++}`;
		this.sessions.set(sessionId, { browser, persistentContext });
		const cdpEndpoint = await fetchWebSocketDebuggerUrl(port).catch(
			async (createError: unknown) => {
				const closeError = await this.closeSession(sessionId);
				if (closeError instanceof Error) {
					throw new AggregateError(
						[createError, closeError],
						"Local browser creation and cleanup both failed.",
					);
				}
				throw createError;
			},
		);
		return { sessionId, cdpEndpoint, startUrlPreloaded: false };
	}

	async closeSession(sessionId: string): Promise<ProviderCloseResult> {
		const session = this.sessions.get(sessionId);
		if (!session) return {};
		const closed = await (
			session.persistentContext?.close() ?? session.browser.close()
		).catch(
			(cause: unknown) =>
				new ProviderCloseError({
					provider: this.name,
					providerSessionId: sessionId,
					detail: errorMessage(cause),
					recovery:
						"Call closeSession again; if it still fails, stop the local Chromium process.",
					cause,
				}),
		);
		if (closed instanceof Error) return closed;
		this.sessions.delete(sessionId);
		return {};
	}
}
