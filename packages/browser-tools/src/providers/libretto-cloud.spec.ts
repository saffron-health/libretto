import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { expect, test as base } from "vitest";
import { createBrowserTools } from "../create-browser-tools.js";
import { LibrettoCloudBrowserProvider } from "./libretto-cloud.js";

const hasLibrettoApiKey = Boolean(process.env.LIBRETTO_API_KEY?.trim());
const endpoint = (
	process.env.LIBRETTO_API_URL?.trim() ?? "https://api.libretto.sh"
).replace(/\/$/, "");

async function deleteProfile(name: string): Promise<void> {
	const response = await fetch(`${endpoint}/v1/browserProfiles/delete`, {
		method: "POST",
		headers: {
			"x-api-key": process.env.LIBRETTO_API_KEY?.trim() ?? "",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ json: { name } }),
	});
	if (!response.ok) {
		throw new Error(
			`Could not delete Libretto Cloud test profile (${response.status}).`,
		);
	}
}

const test = base.extend<{
	librettoCloud: {
		profileName: string;
		toolkit: ReturnType<typeof createBrowserTools>;
	};
}>({
	librettoCloud: async ({}, use) => {
		const profileName = `browser-tools-test-${randomUUID()}`;
		const toolkit = createBrowserTools(new LibrettoCloudBrowserProvider());
		await use({ profileName, toolkit });
		const disposed = await toolkit.dispose();
		const profileCleanupError = await deleteProfile(profileName).then(
			() => undefined,
			(cause: unknown) =>
				cause instanceof Error ? cause : new Error(String(cause)),
		);
		const cleanupErrors = [disposed, profileCleanupError].filter(
			(error): error is Error => error instanceof Error,
		);
		if (cleanupErrors.length === 1 && cleanupErrors[0]) throw cleanupErrors[0];
		if (cleanupErrors.length > 1) {
			throw new AggregateError(
				cleanupErrors,
				"Libretto Cloud test cleanup failed.",
			);
		}
	},
});

test.runIf(hasLibrettoApiKey)(
	"creates, connects to, and closes a Libretto Cloud browser",
	async () => {
		const provider = new LibrettoCloudBrowserProvider();
		const session = await provider.createSession();
		if (session instanceof Error) throw session;
		const browser = await chromium.connectOverCDP(session.cdpEndpoint);

		expect(browser.isConnected()).toBe(true);

		const closed = await provider.closeSession(session.sessionId);
		if (closed instanceof Error) throw closed;
	},
);

test.runIf(hasLibrettoApiKey)(
	"persists state in a named Libretto Cloud profile",
	async ({ librettoCloud }) => {
		const firstSession =
			await librettoCloud.toolkit.tools.browser_open.execute({
				authProfile: librettoCloud.profileName,
			});
		if (!firstSession.ok) throw new Error(firstSession.error);
		const changed = await librettoCloud.toolkit.tools.browser_exec.execute({
			sessionId: firstSession.sessionId,
			code:
				"await page.goto('https://example.com'); " +
				`await page.evaluate(() => localStorage.setItem('browser-tools-profile', '${librettoCloud.profileName}')); ` +
				"return true;",
		});
		expect(changed).toMatchObject({ ok: true, result: true });
		expect(
			await librettoCloud.toolkit.tools.browser_close.execute({
				sessionId: firstSession.sessionId,
			}),
		).toEqual({ ok: true });

		const restoredSession =
			await librettoCloud.toolkit.tools.browser_open.execute({
				authProfile: librettoCloud.profileName,
			});
		if (!restoredSession.ok) throw new Error(restoredSession.error);
		const restored = await librettoCloud.toolkit.tools.browser_exec.execute({
			sessionId: restoredSession.sessionId,
			code:
				"await page.goto('https://example.com'); " +
				"return await page.evaluate(() => localStorage.getItem('browser-tools-profile'));",
		});
		expect(restored).toMatchObject({
			ok: true,
			result: librettoCloud.profileName,
		});
	},
	120_000,
);
