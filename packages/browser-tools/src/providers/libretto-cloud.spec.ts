import { chromium } from "playwright";
import { expect, test } from "vitest";
import { LibrettoCloudBrowserProvider } from "./libretto-cloud.js";

test.skipIf(!process.env.LIBRETTO_API_KEY?.trim())(
	"creates, connects to, and closes a Libretto Cloud browser",
	async () => {
		const provider = new LibrettoCloudBrowserProvider();
		const session = await provider.createSession();
		const browser = await chromium.connectOverCDP(session.cdpEndpoint);

		expect(browser.isConnected()).toBe(true);

		const closed = await provider.closeSession(session.sessionId);
		if (closed instanceof Error) throw closed;
	},
);
