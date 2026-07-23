import { expect, test } from "vitest";
import { KernelBrowserProvider } from "./kernel.js";

test.skipIf(!process.env.KERNEL_API_KEY?.trim())(
	"creates, connects to, and closes a Kernel browser",
	async () => {
		const provider = new KernelBrowserProvider();
		const session = await provider.createSession();

		expect(session.page.context().browser()?.isConnected()).toBe(true);

		await provider.closeSession(session.sessionId);
	},
);
