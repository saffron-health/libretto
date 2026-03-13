import type { SessionProvider } from "../../shared/state/index.js";

const DEFAULT_BROWSER_PROVIDER: SessionProvider = "local";

export function getConfiguredBrowserProvider(): SessionProvider {
	const raw = process.env.LIBRETTO_BROWSER_PROVIDER?.trim().toLowerCase();
	if (!raw) {
		return DEFAULT_BROWSER_PROVIDER;
	}

	if (raw === "local" || raw === "kernel") {
		return raw;
	}

	throw new Error(
		[
			`Invalid LIBRETTO_BROWSER_PROVIDER value: ${raw}`,
			"Expected one of: local, kernel.",
		].join("\n"),
	);
}
