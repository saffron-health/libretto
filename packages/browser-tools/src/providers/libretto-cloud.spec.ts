import { expect, test } from "vitest";
import { LibrettoCloudBrowserProvider } from "./libretto-cloud.js";

test.skipIf(!process.env.LIBRETTO_API_KEY?.trim())(
	"creates, connects to, and closes a Libretto Cloud browser",
	async () => {
		const provider = new LibrettoCloudBrowserProvider();
		const session = await provider.createSession();

		expect(session.page.context().browser()?.isConnected()).toBe(true);

		await provider.closeSession(session.sessionId);
	},
);
