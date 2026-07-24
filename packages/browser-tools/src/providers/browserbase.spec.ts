import { expect, test } from "vitest";
import { BrowserbaseBrowserProvider } from "./browserbase.js";

test.skipIf(!process.env.BROWSERBASE_API_KEY?.trim())(
	"creates, connects to, and closes a Browserbase browser",
	async () => {
		const provider = new BrowserbaseBrowserProvider();
		const session = await provider.createSession();

		expect(session.page.context().browser()?.isConnected()).toBe(true);

		await provider.closeSession(session.sessionId);
	},
);
