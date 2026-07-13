import { chromium } from "playwright";
import { expect, test } from "vitest";
import { SteelBrowserProvider } from "./steel.js";

test.skipIf(!process.env.STEEL_API_KEY?.trim())(
	"creates, connects to, and closes a Steel browser",
	async () => {
		const provider = new SteelBrowserProvider();
		const session = await provider.createSession();
		const browser = await chromium.connectOverCDP(session.cdpEndpoint);

		expect(browser.isConnected()).toBe(true);

		await provider.closeSession(session.sessionId);
	},
);
