import { expect, test as base } from "vitest";
import { LocalBrowserProvider } from "../src/providers/local.js";
import { SessionRegistry } from "../src/session-registry.js";

const test = base.extend<{ registry: SessionRegistry }>({
	registry: async ({}, use) => {
		const registry = new SessionRegistry(new LocalBrowserProvider());
		await use(registry);
		await registry.dispose();
	},
});

test("openSession returns a ses- ID and a usable current page", async ({
	registry,
}) => {
	const { sessionId } = await registry.openSession();
	expect(sessionId).toMatch(/^ses-[0-9a-f]{4,}$/);

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
	const { context } = registry.getSession(sessionId);

	const newest = await context.newPage();
	await newest.goto("data:text/html,<title>newest</title>");

	expect(registry.getCurrentPage(sessionId)).toBe(newest);
	expect(await registry.getCurrentPage(sessionId).title()).toBe("newest");
});

test("unknown session ID throws with the ID in the message", ({ registry }) => {
	expect(() => registry.getCurrentPage("ses-nope")).toThrowError(/ses-nope/);
	expect(() => registry.getSession("ses-nope")).toThrowError(/ses-nope/);
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
