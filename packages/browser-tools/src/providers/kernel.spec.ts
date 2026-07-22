import { chromium } from "playwright";
import { expect, test } from "vitest";
import { KernelBrowserProvider } from "./kernel.js";

test.skipIf(!process.env.KERNEL_API_KEY?.trim())(
	"creates, connects to, and closes a Kernel browser",
	async () => {
		const provider = new KernelBrowserProvider();
		const session = await provider.createSession();
		const browser = await chromium.connectOverCDP(session.cdpEndpoint);

		expect(browser.isConnected()).toBe(true);

		const closed = await provider.closeSession(session.sessionId);
		if (closed instanceof Error) throw closed;
	},
);
