import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { BrowserbaseBrowserProvider } from "../../src/providers/browserbase.js";
import { BrowserUseBrowserProvider } from "../../src/providers/browser-use.js";
import { KernelBrowserProvider } from "../../src/providers/kernel.js";
import { LocalBrowserProvider } from "../../src/providers/local.js";
import { SteelBrowserProvider } from "../../src/providers/steel.js";
import { getProviderSessionCdpEndpoint } from "../../src/provider.js";
import { DEFAULT_TIMEOUT_MS } from "../agent.js";

type BenchmarkBrowserProvider =
	| BrowserbaseBrowserProvider
	| BrowserUseBrowserProvider
	| KernelBrowserProvider
	| LocalBrowserProvider
	| SteelBrowserProvider;

const BROWSER_TOOLS_PACKAGE_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);

export const BROWSER_PROVIDERS = [
	"kernel",
	"browserbase",
	"browser-use",
	"local",
	"steel",
] as const;
export type BrowserProviderName = (typeof BROWSER_PROVIDERS)[number];

export type CloudBrowserConnection = {
	provider: BrowserProviderName;
	cdpEndpoint: string;
	sessionId: string;
	sessionName: string;
	close(): Promise<void>;
};

export function createBenchmarkBrowserProvider(
	provider: BrowserProviderName,
): BenchmarkBrowserProvider {
	switch (provider) {
		case "browserbase":
			return new BrowserbaseBrowserProvider({
				proxies: true,
				solveCaptchas: true,
				timeoutSeconds: Math.ceil(DEFAULT_TIMEOUT_MS / 1000),
			});
		case "kernel":
			return new KernelBrowserProvider({
				headless: false,
				stealth: true,
				timeoutSeconds: Math.ceil(DEFAULT_TIMEOUT_MS / 1000),
			});
		case "browser-use":
			return new BrowserUseBrowserProvider({
				proxyCountryCode: "us",
				timeoutMinutes: Math.ceil(DEFAULT_TIMEOUT_MS / 60_000),
			});
		case "local":
			return new LocalBrowserProvider({
				channel: "chrome",
				headless: false,
			});
		case "steel":
			return new SteelBrowserProvider({
				useProxy: true,
				solveCaptcha: true,
				timeoutMs: DEFAULT_TIMEOUT_MS,
				inactivityTimeoutMs: DEFAULT_TIMEOUT_MS,
			});
	}
}

export async function createCloudBrowserConnection(
	providerName: BrowserProviderName,
): Promise<CloudBrowserConnection> {
	const provider = createBenchmarkBrowserProvider(providerName);
	const session = await provider.createSession();
	const cdpEndpoint = getProviderSessionCdpEndpoint(session);
	if (!cdpEndpoint) {
		await provider.closeSession(session.sessionId);
		throw new Error(
			`${providerName} did not expose its benchmark CDP endpoint. Use a provider that supports CDP attachment.`,
		);
	}
	return {
		provider: providerName,
		cdpEndpoint,
		sessionId: session.sessionId,
		sessionName: `benchmark-${session.sessionId}`,
		async close() {
			await provider.closeSession(session.sessionId);
		},
	};
}

export async function closeCloudBrowserConnection(
	connection: CloudBrowserConnection,
): Promise<void> {
	try {
		await connection.close();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(
			`${connection.provider} cleanup also failed: ${message}\n`,
		);
	}
}

export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function packageCliCommand(command: string): string {
	return `pnpm --dir ${shellQuote(BROWSER_TOOLS_PACKAGE_DIR)} exec ${command}`;
}
