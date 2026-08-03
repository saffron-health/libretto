import { errorMessage } from "../errors.js";
import type { BrowserProvider } from "../provider.js";
import { BrowserbaseBrowserProvider } from "../providers/browserbase.js";
import { BrowserUseBrowserProvider } from "../providers/browser-use.js";
import { KernelBrowserProvider } from "../providers/kernel.js";
import { LibrettoCloudBrowserProvider } from "../providers/libretto-cloud.js";
import { LocalBrowserProvider } from "../providers/local.js";
import { SteelBrowserProvider } from "../providers/steel.js";

export const CLI_PROVIDER_NAMES = [
	"local",
	"kernel",
	"browserbase",
	"browser-use",
	"steel",
	"libretto-cloud",
] as const;

export type CliProviderName = (typeof CLI_PROVIDER_NAMES)[number];

const HEADLESS_PROVIDERS = new Set<CliProviderName>([
	"local",
	"kernel",
	"libretto-cloud",
]);

export function isCliProviderName(value: string): value is CliProviderName {
	return (CLI_PROVIDER_NAMES as readonly string[]).includes(value);
}

export function providerSupportsHeadless(provider: CliProviderName): boolean {
	return HEADLESS_PROVIDERS.has(provider);
}

export function formatCliProviderList(): string {
	return CLI_PROVIDER_NAMES.join(", ");
}

/**
 * Build the BrowserProvider for the MCP CLI. Cloud providers read API keys from
 * the process environment. Returns Error when credentials are missing or the
 * provider rejects the options.
 */
export function createCliBrowserProvider(options: {
	provider: CliProviderName;
	headless: boolean;
}): BrowserProvider | Error {
	try {
		switch (options.provider) {
			case "local":
				return new LocalBrowserProvider({ headless: options.headless });
			case "kernel":
				return new KernelBrowserProvider({ headless: options.headless });
			case "libretto-cloud":
				return new LibrettoCloudBrowserProvider({
					headless: options.headless,
				});
			case "browserbase":
				return new BrowserbaseBrowserProvider();
			case "browser-use":
				return new BrowserUseBrowserProvider();
			case "steel":
				return new SteelBrowserProvider();
		}
	} catch (error) {
		return new Error(
			`${errorMessage(error)} Set the provider API key in the MCP server environment, or pass --provider local.`,
		);
	}
}
