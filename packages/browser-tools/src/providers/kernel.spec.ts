import { expect, test as base } from "vitest";
import type { ProviderSession } from "../provider.js";
import { KernelBrowserProvider } from "./kernel.js";

const test = base.extend<{ kernelSession: ProviderSession }>({
	kernelSession: async ({}, use) => {
		const provider = new KernelBrowserProvider();
		const session = await provider.createSession();
		await use(session);
		await provider.closeSession(session.sessionId);
	},
});

test("KernelBrowserProvider reports both ways to configure a missing API key", () => {
	expect(() => new KernelBrowserProvider({ apiKey: "" })).toThrowError(
		"KernelBrowserProvider: missing API key. " +
			"Pass new KernelBrowserProvider({ apiKey }) or set KERNEL_API_KEY.",
	);
});

test.skipIf(!process.env.KERNEL_API_KEY?.trim())(
	"KernelBrowserProvider creates a real Kernel browser using KERNEL_API_KEY",
	({ kernelSession }) => {
		expect(kernelSession.sessionId).not.toBe("");
		expect(kernelSession.cdpEndpoint).toMatch(/^wss:\/\//);
	},
);
