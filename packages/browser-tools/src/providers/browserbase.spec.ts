import { chromium } from "playwright";
import { expect, test } from "vitest";
import { BrowserbaseBrowserProvider } from "./browserbase.js";

test.skipIf(
	!process.env.BROWSERBASE_API_KEY?.trim() ||
		!process.env.BROWSERBASE_PROJECT_ID?.trim(),
)(
	"creates, connects to, and closes a Browserbase browser",
	async () => {
		const provider = new BrowserbaseBrowserProvider();
		const session = await provider.createSession();
		const browser = await chromium.connectOverCDP(session.cdpEndpoint);

		expect(browser.isConnected()).toBe(true);

		await provider.closeSession(session.sessionId);
	},
);
