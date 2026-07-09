import { expect, test as base, vi } from "vitest";
import { LocalBrowserProvider } from "./providers/local.js";
import { SessionRegistry } from "./session-registry.js";

const test = base.extend<{ registry: SessionRegistry }>({
	registry: async ({}, use) => {
		const registry = new SessionRegistry(
			new LocalBrowserProvider({ headless: true }),
		);
		await use(registry);
		await registry.dispose();
	},
});

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
