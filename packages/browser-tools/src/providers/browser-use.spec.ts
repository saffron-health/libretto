import { randomUUID } from "node:crypto";
import { expect, test as base } from "vitest";
import { createBrowserTools } from "../create-browser-tools.js";
import { BrowserUseBrowserProvider } from "./browser-use.js";

const hasBrowserUseApiKey = Boolean(process.env.BROWSER_USE_API_KEY?.trim());
const endpoint = "https://api.browser-use.com/api/v3";

type ProfileListResponse = {
	items: Array<{ id: string; name?: string | null }>;
	totalItems: number;
	pageNumber: number;
	pageSize: number;
}

async function deleteProfilesNamed(name: string): Promise<void> {
	const headers = {
		"X-Browser-Use-API-Key": process.env.BROWSER_USE_API_KEY?.trim() ?? "",
	};
	const profileIds: string[] = [];
	let pageNumber = 1;
	while (true) {
		const query = new URLSearchParams({
			query: name,
			pageSize: "100",
			pageNumber: String(pageNumber),
		});
		const response = await fetch(`${endpoint}/profiles?${query.toString()}`, {
			headers,
		});
		if (!response.ok) {
			throw new Error(`Could not list Browser Use test profiles (${response.status}).`);
		}
		const profiles = (await response.json()) as ProfileListResponse;
		for (const profile of profiles.items) {
			if (profile.name === name) profileIds.push(profile.id);
		}
		if (profiles.pageNumber * profiles.pageSize >= profiles.totalItems) break;
		pageNumber += 1;
	}

	for (const profileId of profileIds) {
		const deleted = await fetch(`${endpoint}/profiles/${profileId}`, {
			method: "DELETE",
			headers,
		});
		if (!deleted.ok) {
			throw new Error(
				`Could not delete Browser Use test profile ${profileId} (${deleted.status}).`,
			);
		}
	}
}

const test = base.extend<{
	browserUse: {
		profileName: string;
		provider: BrowserUseBrowserProvider;
		toolkit: ReturnType<typeof createBrowserTools>;
	};
}>({
	browserUse: async ({}, use) => {
		const profileName = `browser-tools-test-${randomUUID()}`;
		const provider = new BrowserUseBrowserProvider({ endpoint });
		const toolkit = createBrowserTools(provider);
		await use({ profileName, provider, toolkit });
		const disposed = await toolkit.dispose();
		const profileCleanupError = await deleteProfilesNamed(profileName).then(
			() => undefined,
			(cause: unknown) =>
				cause instanceof Error ? cause : new Error(String(cause)),
		);
		const cleanupErrors = [disposed, profileCleanupError].filter(
			(error): error is Error => error instanceof Error,
		);
		if (cleanupErrors.length === 1 && cleanupErrors[0]) throw cleanupErrors[0];
		if (cleanupErrors.length > 1) {
			throw new AggregateError(cleanupErrors, "Browser Use test cleanup failed.");
		}
	},
});

test.runIf(hasBrowserUseApiKey)(
	"creates and reuses a named Browser Use profile",
	async ({ browserUse }) => {
		expect(browserUse.provider.supportsAuthProfiles).toBe(true);

		const firstSession = await browserUse.toolkit.tools.browser_open.execute({
			authProfile: browserUse.profileName,
		});
		if (!firstSession.ok) throw new Error(firstSession.error);
		const changed = await browserUse.toolkit.tools.browser_exec.execute({
			sessionId: firstSession.sessionId,
			code:
				"await page.goto('https://example.com'); " +
				`await page.evaluate(() => localStorage.setItem('browser-tools-profile', '${browserUse.profileName}')); ` +
				"return true;",
		});
		expect(changed).toMatchObject({ ok: true, result: true });
		expect(
			await browserUse.toolkit.tools.browser_close.execute({
				sessionId: firstSession.sessionId,
			}),
		).toEqual({ ok: true });

		const reusedSession = await browserUse.toolkit.tools.browser_open.execute({
			authProfile: browserUse.profileName,
		});
		if (!reusedSession.ok) throw new Error(reusedSession.error);
		const restored = await browserUse.toolkit.tools.browser_exec.execute({
			sessionId: reusedSession.sessionId,
			code:
				"await page.goto('https://example.com'); " +
				"return await page.evaluate(() => localStorage.getItem('browser-tools-profile'));",
		});
		expect(restored).toMatchObject({
			ok: true,
			result: browserUse.profileName,
		});
		expect(
			await browserUse.toolkit.tools.browser_close.execute({
				sessionId: reusedSession.sessionId,
			}),
		).toEqual({ ok: true });
	},
);
