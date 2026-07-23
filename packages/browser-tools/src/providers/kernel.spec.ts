import { expect, test as base } from "vitest";
import { createBrowserTools } from "../create-browser-tools.js";
import { KernelBrowserProvider } from "./kernel.js";

const hasKernelApiKey = Boolean(process.env.KERNEL_API_KEY?.trim());
const profileName = `browser-tools-test-${process.env.GITHUB_RUN_ID?.trim() || "local"}`;

const test = base.extend<{
	kernel: {
		provider: KernelBrowserProvider;
		toolkit: ReturnType<typeof createBrowserTools>;
	};
}>({
	kernel: async ({}, use) => {
		const provider = new KernelBrowserProvider();
		const toolkit = createBrowserTools(provider);
		await use({ provider, toolkit });
		const disposed = await toolkit.dispose();
		if (disposed instanceof Error) throw disposed;
	},
});

test.runIf(hasKernelApiKey)(
	"rejects an invalid Kernel profile name",
	async ({ kernel }) => {
		const result = await kernel.toolkit.tools.browser_open.execute({
			authProfile: "team/work",
		});

		expect(result).toMatchObject({ ok: false });
		if (result.ok) throw new Error("Expected the invalid profile to be rejected.");
		expect(result.error).toContain("Use 1-255 letters");
	},
);

test.runIf(hasKernelApiKey)(
	"restores state from a persistent Kernel profile",
	async ({ kernel }) => {
		expect(kernel.provider.supportsAuthProfiles).toBe(true);

		const firstSession = await kernel.toolkit.tools.browser_open.execute({
			authProfile: profileName,
		});
		if (!firstSession.ok) throw new Error(firstSession.error);
		const changed = await kernel.toolkit.tools.browser_exec.execute({
			sessionId: firstSession.sessionId,
			code:
				"await page.goto('https://example.com'); " +
				`await page.evaluate(() => localStorage.setItem('browser-tools-profile', '${profileName}')); ` +
				"return true;",
		});
		expect(changed).toMatchObject({ ok: true, result: true });
		expect(
			await kernel.toolkit.tools.browser_close.execute({
				sessionId: firstSession.sessionId,
			}),
		).toEqual({ ok: true });

		const reusedSession = await kernel.toolkit.tools.browser_open.execute({
			authProfile: profileName,
		});
		if (!reusedSession.ok) throw new Error(reusedSession.error);
		const restored = await kernel.toolkit.tools.browser_exec.execute({
			sessionId: reusedSession.sessionId,
			code:
				"await page.goto('https://example.com'); " +
				"return await page.evaluate(() => localStorage.getItem('browser-tools-profile'));",
		});
		expect(restored).toMatchObject({ ok: true, result: profileName });
		expect(
			await kernel.toolkit.tools.browser_close.execute({
				sessionId: reusedSession.sessionId,
			}),
		).toEqual({ ok: true });
	},
);

test.runIf(hasKernelApiKey)(
	"creates, connects to, and closes a Kernel browser",
	async ({ kernel }) => {
		const session = await kernel.toolkit.tools.browser_open.execute({});
		expect(session).toMatchObject({ ok: true });
		if (!session.ok) throw new Error(session.error);
		expect(
			await kernel.toolkit.tools.browser_close.execute({
				sessionId: session.sessionId,
			}),
		).toEqual({ ok: true });
	},
);
