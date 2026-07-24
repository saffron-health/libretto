import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { expect, test as base, vi } from "vitest";
import type { BrowserProvider } from "./provider.js";
import { LocalBrowserProvider } from "./providers/local.js";
import { SessionRegistry } from "./session-registry.js";

const test = base.extend<{ browser: Browser; registry: SessionRegistry }>({
	browser: async ({}, use) => {
		const browser = await chromium.launch({ headless: true });
		await use(browser);
		await browser.close();
	},
	registry: async ({}, use) => {
		const registry = new SessionRegistry(
			new LocalBrowserProvider({ headless: true }),
		);
		await use(registry);
		await registry.dispose();
	},
});

function providerReturning(
	page: Page,
	closeSession: BrowserProvider["closeSession"],
): BrowserProvider {
	return {
		name: "selected-page",
		async createSession() {
			return { sessionId: "host-window", page };
		},
		closeSession,
	};
}

test("openSession returns a session ID and a usable current page", async ({
	registry,
}) => {
	const { sessionId } = await registry.openSession();
	const page = registry.getCurrentPage(sessionId);
	await page.goto("data:text/html,<title>hello</title>");
	expect(await page.title()).toBe("hello");
});

test("a second openSession gives an independent session with a different ID", async ({
	registry,
}) => {
	const first = await registry.openSession();
	const second = await registry.openSession();
	expect(second.sessionId).not.toBe(first.sessionId);

	await registry
		.getCurrentPage(first.sessionId)
		.goto("data:text/html,<title>one</title>");
	await registry
		.getCurrentPage(second.sessionId)
		.goto("data:text/html,<title>two</title>");

	expect(await registry.getCurrentPage(first.sessionId).title()).toBe("one");
	expect(await registry.getCurrentPage(second.sessionId).title()).toBe("two");
});

test("getCurrentPage tracks the newest page in the session", async ({
	registry,
}) => {
	const { sessionId } = await registry.openSession();
	const context = registry.getCurrentPage(sessionId).context();

	const newest = await context.newPage();
	await newest.goto("data:text/html,<title>newest</title>");

	expect(registry.getCurrentPage(sessionId)).toBe(newest);
	expect(await registry.getCurrentPage(sessionId).title()).toBe("newest");

	const [session] = registry.listSessions();
	expect(session.pages).toHaveLength(2);
	expect(session.pages.filter((page) => page.active)).toEqual([
		expect.objectContaining({ url: expect.stringContaining("newest") }),
	]);
});

test("openSession registers only the page selected by the provider", async ({
	browser,
}) => {
	const context = await browser.newContext();
	const selectedPage = await context.newPage();
	await selectedPage.goto("data:text/html,<title>selected</title>");
	const unrelatedPage = await context.newPage();
	await unrelatedPage.goto("data:text/html,<title>unrelated</title>");
	const closeSession = vi.fn(async () => ({}));
	const registry = new SessionRegistry(
		providerReturning(selectedPage, closeSession),
	);

	const { sessionId } = await registry.openSession();

	expect(registry.getCurrentPage(sessionId)).toBe(selectedPage);
	expect(registry.listSessions()[0].pages).toEqual([
		expect.objectContaining({ url: expect.stringContaining("selected") }),
	]);

	await registry.closeSession(sessionId);
	expect(closeSession).toHaveBeenCalledOnce();
	expect(browser.isConnected()).toBe(true);
	expect(selectedPage.isClosed()).toBe(false);
	await registry.dispose();
});

test("failed page registration closes the provider session once", async ({
	browser,
}) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto("https://example.com");
	const closeSession = vi.fn(async () => ({}));
	const registry = new SessionRegistry(
		providerReturning(page, closeSession),
		{ blockedDomains: ["example.com"] },
	);

	await expect(registry.openSession()).rejects.toMatchObject({
		name: "DomainPolicyRestricted",
		attemptedNavigationUrl: "https://example.com/",
	});

	expect(closeSession).toHaveBeenCalledOnce();
	expect(browser.isConnected()).toBe(true);
	await page.reload();
	expect(page.url()).toBe("https://example.com/");
	await registry.dispose();
});

test("unknown session ID throws with the ID in the message", ({ registry }) => {
	expect(() => registry.getCurrentPage("ses-nope")).toThrowError(/ses-nope/);
});

test("closeSession makes the session unknown", async ({ registry }) => {
	const { sessionId } = await registry.openSession();
	await registry.closeSession(sessionId);

	expect(() => registry.getCurrentPage(sessionId)).toThrowError(sessionId);
});

test("dispose closes all sessions and is idempotent", async ({ registry }) => {
	const first = await registry.openSession();
	const second = await registry.openSession();

	await registry.dispose();

	expect(() => registry.getCurrentPage(first.sessionId)).toThrowError(
		first.sessionId,
	);
	expect(() => registry.getCurrentPage(second.sessionId)).toThrowError(
		second.sessionId,
	);

	await registry.dispose();
});

test("beforeExit disposes leftover sessions as a backstop", async ({
	registry,
}) => {
	await registry.openSession();
	expect(registry.listSessions()).toHaveLength(1);

	process.emit("beforeExit", 0);

	await vi.waitFor(() => expect(registry.listSessions()).toHaveLength(0));
});

test("dispose removes the beforeExit hook it installed", async ({ registry }) => {
	const before = process.listenerCount("beforeExit");
	await registry.openSession();
	expect(process.listenerCount("beforeExit")).toBeGreaterThan(before);

	await registry.dispose();
	expect(process.listenerCount("beforeExit")).toBe(before);
});
