import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test as base } from "vitest";
import {
	type BrowserProvider,
	type ProviderSessionCreateOptions,
	ProviderCloseError,
} from "./provider.js";
import { LocalBrowserProvider } from "./providers/local.js";
import { SessionRegistry } from "./session-registry.js";
import { createStatusTool } from "./tools/status.js";

const test = base.extend<{
	authProfileDirectory: string;
	createRegistry: (provider: BrowserProvider) => SessionRegistry;
	registry: SessionRegistry;
}>({
	authProfileDirectory: async ({}, use) => {
		const directory = await mkdtemp(join(tmpdir(), "browser-tools-profiles-"));
		await use(directory);
		await rm(directory, { recursive: true, force: true });
	},
	createRegistry: async ({}, use) => {
		let registry: SessionRegistry | undefined;
		await use((provider) => {
			if (registry) throw new Error("This fixture owns one registry per test.");
			registry = new SessionRegistry(provider);
			return registry;
		});
		const disposed = await registry?.dispose();
		if (disposed instanceof Error) throw disposed;
	},
	registry: async ({ authProfileDirectory }, use) => {
		const registry = new SessionRegistry(
			new LocalBrowserProvider({ headless: true, authProfileDirectory }),
		);
		await use(registry);
		const disposed = await registry.dispose();
		if (disposed instanceof Error) throw disposed;
	},
});

test("openSession returns a session ID and a usable current page", async ({
	registry,
}) => {
	const opened = await registry.openSession();
	if (opened instanceof Error) throw opened;
	const { sessionId } = opened;
	const page = registry.getCurrentPage(sessionId);
	await page.goto("data:text/html,<title>hello</title>");
	expect(await page.title()).toBe("hello");
});

test("a second openSession gives an independent session with a different ID", async ({
	registry,
}) => {
	const first = await registry.openSession({ authProfile: false });
	if (first instanceof Error) throw first;
	const second = await registry.openSession({ authProfile: false });
	if (second instanceof Error) throw second;
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
	const opened = await registry.openSession();
	if (opened instanceof Error) throw opened;
	const { sessionId } = opened;
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
	const opened = await registry.openSession();
	if (opened instanceof Error) throw opened;
	const { sessionId } = opened;
	const closed = await registry.closeSession(sessionId);
	if (closed instanceof Error) throw closed;

	expect(() => registry.getCurrentPage(sessionId)).toThrowError(sessionId);
});

test("closeSession releases the provider before disconnecting CDP", async ({
	createRegistry,
}) => {
	const localProvider = new LocalBrowserProvider({ headless: true });
	let registryBrowserConnectedWhenProviderClosed = false;
	let registryBrowserConnected: (() => boolean) | undefined;
	const registry = createRegistry({
		name: "ordered-close",
		createSession: () => localProvider.createSession(),
		async closeSession(sessionId) {
			registryBrowserConnectedWhenProviderClosed =
				registryBrowserConnected?.() ?? false;
			return localProvider.closeSession(sessionId);
		},
	});
	const opened = await registry.openSession();
	if (opened instanceof Error) throw opened;
	const browser = registry.getCurrentPage(opened.sessionId).context().browser();
	if (!browser) throw new Error("Expected a connected browser.");
	registryBrowserConnected = () => browser.isConnected();

	const closed = await registry.closeSession(opened.sessionId);
	if (closed instanceof Error) throw closed;

	expect(registryBrowserConnectedWhenProviderClosed).toBe(true);
	expect(browser.isConnected()).toBe(false);
});

test("closeSession removes the session when provider cleanup fails", async ({
	createRegistry,
}) => {
	const localProvider = new LocalBrowserProvider({ headless: true });
	const registry = createRegistry({
		name: "failing-close",
		createSession: () => localProvider.createSession(),
		async closeSession(sessionId) {
			const closed = await localProvider.closeSession(sessionId);
			if (closed instanceof Error) return closed;
			throw new Error("provider cleanup failed");
		},
	});
	const opened = await registry.openSession();
	if (opened instanceof Error) throw opened;

	const closed = await registry.closeSession(opened.sessionId);
	expect(closed).toBeInstanceOf(ProviderCloseError);
	expect(closed?.message).toContain("provider cleanup failed");
	expect(() => registry.getCurrentPage(opened.sessionId)).toThrowError(
		opened.sessionId,
	);
	expect(registry.listSessions()).toEqual([]);
});

test("dispose closes remaining sessions after one provider cleanup fails", async ({
	createRegistry,
}) => {
	const localProvider = new LocalBrowserProvider({ headless: true });
	const closedProviderSessionIds: string[] = [];
	const registry = createRegistry({
		name: "partly-failing-close",
		createSession: () => localProvider.createSession(),
		async closeSession(sessionId) {
			closedProviderSessionIds.push(sessionId);
			const closed = await localProvider.closeSession(sessionId);
			if (closed instanceof Error) return closed;
			if (sessionId === "local-1") {
				return new ProviderCloseError({
					provider: "partly-failing-close",
					providerSessionId: sessionId,
					detail: "first provider cleanup failed",
					recovery: "Retry provider cleanup.",
				});
			}
			return {};
		},
	});
	const first = await registry.openSession();
	if (first instanceof Error) throw first;
	const second = await registry.openSession();
	if (second instanceof Error) throw second;

	const disposed = await registry.dispose();
	expect(disposed).toBeInstanceOf(ProviderCloseError);
	expect(disposed?.message).toContain("first provider cleanup failed");
	expect(closedProviderSessionIds).toEqual(["local-1", "local-2"]);
	expect(registry.listSessions()).toEqual([]);
});

test("dispose closes all sessions and is idempotent", async ({ registry }) => {
	const first = await registry.openSession({ authProfile: false });
	if (first instanceof Error) throw first;
	const second = await registry.openSession({ authProfile: false });
	if (second instanceof Error) throw second;

	const disposed = await registry.dispose();
	if (disposed instanceof Error) throw disposed;

	expect(() => registry.getCurrentPage(first.sessionId)).toThrowError(
		first.sessionId,
	);
	expect(() => registry.getCurrentPage(second.sessionId)).toThrowError(
		second.sessionId,
	);

	const disposedAgain = await registry.dispose();
	if (disposedAgain instanceof Error) throw disposedAgain;
});

test("openSession uses the default auth profile when the provider supports profiles", async ({
	authProfileDirectory,
	createRegistry,
}) => {
	const localProvider = new LocalBrowserProvider({
		headless: true,
		authProfileDirectory,
	});
	let requestedOptions: ProviderSessionCreateOptions | undefined;
	const registry = createRegistry({
		name: "profiled",
		supportsAuthProfiles: true,
		createSession(options) {
			requestedOptions = options;
			return localProvider.createSession(options);
		},
		closeSession: (sessionId) => localProvider.closeSession(sessionId),
	});

	const opened = await registry.openSession();
	if (opened instanceof Error) throw opened;

	expect(requestedOptions?.authProfile).toBe("default");
	expect(registry.listSessions()).toEqual([
		expect.objectContaining({
			sessionId: opened.sessionId,
			provider: "profiled",
			authProfile: "default",
		}),
	]);
});

test("openSession preserves an explicit auth profile", async ({
	authProfileDirectory,
	createRegistry,
}) => {
	const localProvider = new LocalBrowserProvider({
		headless: true,
		authProfileDirectory,
	});
	let requestedOptions: ProviderSessionCreateOptions | undefined;
	const registry = createRegistry({
		name: "profiled",
		supportsAuthProfiles: true,
		createSession(options) {
			requestedOptions = options;
			return localProvider.createSession(options);
		},
		closeSession: (sessionId) => localProvider.closeSession(sessionId),
	});

	const opened = await registry.openSession({ authProfile: "work" });
	if (opened instanceof Error) throw opened;

	expect(requestedOptions?.authProfile).toBe("work");
	const status = await createStatusTool(registry).execute({});
	expect(status).toMatchObject({
		ok: true,
		sessions: [
			{
				sessionId: opened.sessionId,
				authProfile: "work",
			},
		],
	});
});

test("openSession starts without a profile when authProfile is false", async ({
	authProfileDirectory,
	createRegistry,
}) => {
	const localProvider = new LocalBrowserProvider({
		headless: true,
		authProfileDirectory,
	});
	let requestedOptions: ProviderSessionCreateOptions | undefined;
	const registry = createRegistry({
		name: "profiled",
		supportsAuthProfiles: true,
		createSession(options) {
			requestedOptions = options;
			return localProvider.createSession(options);
		},
		closeSession: (sessionId) => localProvider.closeSession(sessionId),
	});

	const opened = await registry.openSession({ authProfile: false });
	if (opened instanceof Error) throw opened;

	expect(requestedOptions?.authProfile).toBeUndefined();
	const status = await createStatusTool(registry).execute({});
	if (!status.ok || !("sessions" in status)) throw new Error("expected sessions");
	expect(status.sessions[0]).not.toHaveProperty("authProfile");
});

test("openSession leaves an unsupported provider unprofiled when authProfile is omitted", async ({
	authProfileDirectory,
	createRegistry,
}) => {
	const localProvider = new LocalBrowserProvider({
		headless: true,
		authProfileDirectory,
	});
	let requestedOptions: ProviderSessionCreateOptions | undefined;
	const registry = createRegistry({
		name: "unsupported",
		supportsAuthProfiles: false,
		createSession(options) {
			requestedOptions = options;
			return localProvider.createSession(options);
		},
		closeSession: (sessionId) => localProvider.closeSession(sessionId),
	});

	const opened = await registry.openSession();
	if (opened instanceof Error) throw opened;

	expect(requestedOptions?.authProfile).toBeUndefined();
	const status = await createStatusTool(registry).execute({});
	if (!status.ok || !("sessions" in status)) throw new Error("expected sessions");
	expect(status.sessions[0]).not.toHaveProperty("authProfile");
});

test("openSession rejects an explicit profile for an unsupported provider", async ({
	createRegistry,
}) => {
	let created = false;
	const registry = createRegistry({
		name: "unsupported",
		supportsAuthProfiles: false,
		async createSession() {
			created = true;
			throw new Error("Unexpected createSession call.");
		},
		async closeSession() {
			return {};
		},
	});

	const opened = await registry.openSession({ authProfile: "work" });

	expect(opened).toMatchObject({
		name: "AuthProfileError",
		message: expect.stringContaining("does not support auth profiles"),
	});
	expect(created).toBe(false);
});
