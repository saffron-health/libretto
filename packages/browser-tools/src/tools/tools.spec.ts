import { createServer } from "node:net";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import { expect, test as base } from "vitest";
import { DomainPolicyRestricted } from "../domain-policy.js";
import { LocalBrowserProvider } from "../providers/local.js";
import { SessionRegistry } from "../session-registry.js";
import { createCloseTool } from "./close.js";
import { createConnectTool } from "./connect.js";
import { createExecTool } from "./exec.js";
import { createOpenTool } from "./open.js";
import { createSnapshotTool } from "./snapshot.js";
import { createStatusTool } from "./status.js";

async function pickFreePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (addr && typeof addr === "object") {
				server.close(() => resolve(addr.port));
				return;
			}
			server.close(() => reject(new Error("Failed to resolve debug port")));
		});
	});
}

async function fetchWebSocketDebuggerUrl(port: number): Promise<string> {
	const versionUrl = `http://127.0.0.1:${port}/json/version`;
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(versionUrl);
			const info = (await response.json()) as {
				webSocketDebuggerUrl?: string;
			};
			if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
		} catch {
			// Not listening yet; retry below.
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Could not read webSocketDebuggerUrl from ${versionUrl}`);
}

const test = base.extend<{
	registry: SessionRegistry;
	openTool: ReturnType<typeof createOpenTool>;
	execTool: ReturnType<typeof createExecTool>;
	snapshotTool: ReturnType<typeof createSnapshotTool>;
	statusTool: ReturnType<typeof createStatusTool>;
	closeTool: ReturnType<typeof createCloseTool>;
	connectTool: ReturnType<typeof createConnectTool>;
	externalBrowser: { browser: Browser; cdpUrl: string };
}>({
	registry: async ({}, use) => {
		const registry = new SessionRegistry(
			new LocalBrowserProvider({ headless: true }),
		);
		await use(registry);
		await registry.dispose();
	},
	openTool: async ({ registry }, use) => {
		await use(createOpenTool(registry));
	},
	execTool: async ({ registry }, use) => {
		await use(createExecTool(registry));
	},
	statusTool: async ({ registry }, use) => {
		await use(createStatusTool(registry));
	},
	closeTool: async ({ registry }, use) => {
		await use(createCloseTool(registry));
	},
	connectTool: async ({ registry }, use) => {
		await use(createConnectTool(registry));
	},
	snapshotTool: async ({ registry }, use) => {
		await use(createSnapshotTool(registry));
	},
	externalBrowser: async ({}, use) => {
		const port = await pickFreePort();
		const browser = await chromium.launch({
			headless: true,
			args: [`--remote-debugging-port=${port}`],
		});
		const cdpUrl = await fetchWebSocketDebuggerUrl(port);
		await use({ browser, cdpUrl });
		await browser.close();
	},
});

test("browser_open navigates to a url and returns a session ID", async ({
	openTool,
}) => {
	const result = await openTool.execute({
		url: "data:text/html,<title>hello</title>",
	});
	expect(result).toEqual({ ok: true, sessionId: expect.any(String) });
});

test("browser_open reports a blocked top-level navigation as a domain policy error", async () => {
	const registry = new SessionRegistry(
		new LocalBrowserProvider({ headless: true }),
		{ blockedDomains: ["example.com"] },
	);
	await expect(
		createOpenTool(registry).execute({
			url: "https://example.com/",
		}),
	).rejects.toMatchObject({
		name: "DomainPolicyRestricted",
		domainPolicy: { blockedDomains: ["example.com"] },
		attemptedNavigationUrl: "https://example.com/",
	});
	await registry.dispose();
});

test("browser_open closes provider sessions when browser setup fails", async () => {
	let closedSessionId: string | undefined;
	const registry = new SessionRegistry({
		name: "unreachable",
		async createSession() {
			return {
				sessionId: "provider-session",
				cdpEndpoint: "ws://127.0.0.1:1",
			};
		},
		async closeSession(sessionId) {
			closedSessionId = sessionId;
			return {};
		},
	});

	await expect(createOpenTool(registry).execute({})).rejects.toThrow();
	expect(closedSessionId).toBe("provider-session");
	await registry.dispose();
});

test("domain policy silently aborts blocked subresources", async () => {
	const registry = new SessionRegistry(
		new LocalBrowserProvider({ headless: true }),
		{ blockedDomains: ["example.com"] },
	);
	const opened = await createOpenTool(registry).execute({
		url:
			'data:text/html,<title>allowed</title><img id="blocked" ' +
			'src="https://example.com/image.png">',
	});
	if (!opened.ok) throw new Error(opened.error);

	const result = await createExecTool(registry).execute({
		sessionId: opened.sessionId,
		code:
			"return await page.locator('#blocked').evaluate(" +
			"(image: HTMLImageElement) => image.naturalWidth)",
	});

	expect(result).toMatchObject({ ok: true, result: 0 });
	await registry.dispose();
});

test("browser_exec runs Playwright code against an open session", async ({
	openTool,
	execTool,
}) => {
	const opened = await openTool.execute({
		url: "data:text/html,<title>hello</title>",
	});
	if (!opened.ok) throw new Error(opened.error);

	const result = await execTool.execute({
		sessionId: opened.sessionId,
		code: "return page.title()",
	});
	expect(result).toMatchObject({
		ok: true,
		result: "hello",
		stdout: "",
		stderr: "",
		snapshotDiff: "",
	});
});

test("browser_exec carries browser state across calls and supports TypeScript", async ({
	openTool,
	execTool,
}) => {
	const opened = await openTool.execute({
		url: "data:text/html,<h1 id='t'>start</h1>",
	});
	if (!opened.ok) throw new Error(opened.error);

	const mutate = await execTool.execute({
		sessionId: opened.sessionId,
		code:
			"await page.locator('#t').evaluate((el: HTMLElement) => { el.textContent = 'updated'; }); " +
			"const label: string = await page.locator('#t').textContent() ?? ''; " +
			"console.log('mutated to', label); " +
			"return label",
	});
	expect(mutate).toMatchObject({
		ok: true,
		result: "updated",
		stdout: "mutated to updated",
		stderr: "",
	});
	expect(mutate.ok && mutate.snapshotDiff.length).toBeGreaterThan(0);

	const read = await execTool.execute({
		sessionId: opened.sessionId,
		code: "return await page.locator('#t').textContent()",
	});
	expect(read).toMatchObject({
		ok: true,
		result: "updated",
		stdout: "",
		stderr: "",
		snapshotDiff: "",
	});
});

test("browser_exec returns ok false for an unknown session ID", async ({
	execTool,
}) => {
	const result = await execTool.execute({
		sessionId: "ses-nope",
		code: "return page.title()",
	});
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.error).toMatch(/ses-nope/);
	expect(result.error).toMatch(/browser_open/);
});

test("browser_status lists sessions and pages at three zoom levels", async ({
	openTool,
	statusTool,
}) => {
	const opened = await openTool.execute({
		url: "data:text/html,<title>status-page</title>",
	});
	if (!opened.ok) throw new Error(opened.error);

	const all = await statusTool.execute({});
	expect(all).toMatchObject({
		ok: true,
		sessions: [
			{
				sessionId: opened.sessionId,
				provider: "local",
				pages: [{ pageId: expect.any(String), url: expect.any(String), active: true }],
			},
		],
	});
	if (!all.ok || !("sessions" in all)) throw new Error("expected sessions");
	const pageId = all.sessions[0].pages[0].pageId;

	const sessionOnly = await statusTool.execute({ sessionId: opened.sessionId });
	if (!sessionOnly.ok || !("pages" in sessionOnly)) throw new Error("expected pages");
	expect(sessionOnly.pages).toEqual([
		{ pageId, url: expect.any(String), active: true },
	]);

	const pageOnly = await statusTool.execute({
		sessionId: opened.sessionId,
		pageId,
	});
	expect(pageOnly).toMatchObject({
		ok: true,
		pageId,
		title: "status-page",
		active: true,
		readyState: expect.any(String),
	});
});

test("browser_close removes a session from browser_status", async ({
	openTool,
	statusTool,
	closeTool,
}) => {
	const opened = await openTool.execute({
		url: "data:text/html,<title>close-me</title>",
	});
	if (!opened.ok) throw new Error(opened.error);

	const closed = await closeTool.execute({ sessionId: opened.sessionId });
	expect(closed).toEqual({ ok: true });

	const all = await statusTool.execute({});
	expect(all).toMatchObject({ ok: true, sessions: [] });
});

test("browser_connect attaches to an external browser and close detaches without killing it", async ({
	connectTool,
	closeTool,
	execTool,
	statusTool,
	externalBrowser,
}) => {
	const context =
		externalBrowser.browser.contexts()[0] ??
		(await externalBrowser.browser.newContext());
	const page = context.pages()[0] ?? (await context.newPage());
	await page.goto("data:text/html,<title>connected</title>");

	const connected = await connectTool.execute({ cdpUrl: externalBrowser.cdpUrl });
	if (!connected.ok) throw new Error(connected.error);

	const status = await statusTool.execute({});
	expect(status).toMatchObject({
		ok: true,
		sessions: [
			{
				sessionId: connected.sessionId,
				provider: "attached",
				pages: [{ pageId: expect.any(String), url: expect.any(String), active: true }],
			},
		],
	});

	const execResult = await execTool.execute({
		sessionId: connected.sessionId,
		code: "return page.url()",
	});
	expect(execResult).toMatchObject({ ok: true, result: expect.any(String) });

	const closed = await closeTool.execute({ sessionId: connected.sessionId });
	expect(closed).toEqual({ ok: true });
	expect(externalBrowser.browser.isConnected()).toBe(true);

	const all = await statusTool.execute({});
	expect(all).toMatchObject({ ok: true, sessions: [] });
});

test("domain policy applies to browser_connect sessions and browser_exec navigations", async ({
	externalBrowser,
}) => {
	const context =
		externalBrowser.browser.contexts()[0] ??
		(await externalBrowser.browser.newContext());
	await context.newPage();

	const registry = new SessionRegistry(
		new LocalBrowserProvider({ headless: true }),
		{ blockedDomains: ["example.com"] },
	);
	const connected = await createConnectTool(registry).execute({
		cdpUrl: externalBrowser.cdpUrl,
	});
	if (!connected.ok) throw new Error(connected.error);

	await expect(
		createExecTool(registry).execute({
			sessionId: connected.sessionId,
			code:
				"await page.goto('https://example.com/').catch(() => undefined); " +
				"return 'caught'",
		}),
	).rejects.toBeInstanceOf(DomainPolicyRestricted);
	await registry.dispose();
});

test("domain policy reports unawaited browser_exec navigations after stabilization", async ({
	externalBrowser,
}) => {
	const context =
		externalBrowser.browser.contexts()[0] ??
		(await externalBrowser.browser.newContext());
	await context.newPage();

	const registry = new SessionRegistry(
		new LocalBrowserProvider({ headless: true }),
		{ blockedDomains: ["example.com"] },
	);
	const connected = await createConnectTool(registry).execute({
		cdpUrl: externalBrowser.cdpUrl,
	});
	if (!connected.ok) throw new Error(connected.error);

	await expect(
		createExecTool(registry).execute({
			sessionId: connected.sessionId,
			code:
				"void page.goto('https://example.com/').catch(() => undefined); " +
				"return 'started'",
		}),
	).rejects.toBeInstanceOf(DomainPolicyRestricted);
	await registry.dispose();
});

test("domain policy rejects a connected browser already showing a blocked page", async ({
	externalBrowser,
}) => {
	const context =
		externalBrowser.browser.contexts()[0] ??
		(await externalBrowser.browser.newContext());
	const page = context.pages()[0] ?? (await context.newPage());
	const blockedUrl = new URL(externalBrowser.cdpUrl);
	blockedUrl.protocol = "http:";
	blockedUrl.pathname = "/json/version";
	blockedUrl.search = "";
	blockedUrl.hash = "";
	await page.goto(blockedUrl.href);

	const registry = new SessionRegistry(
		new LocalBrowserProvider({ headless: true }),
		{ blockedDomains: ["127.0.0.1"] },
	);

	await expect(
		createConnectTool(registry).execute({ cdpUrl: externalBrowser.cdpUrl }),
	).rejects.toMatchObject({
		name: "DomainPolicyRestricted",
		attemptedNavigationUrl: blockedUrl.href,
	});
	expect(externalBrowser.browser.isConnected()).toBe(true);
	await registry.dispose();
});

test("browser_exec snapshot diff uses per-page cache across mixed pageId calls", async ({
	openTool,
	execTool,
	statusTool,
}) => {
	const opened = await openTool.execute({
		url: "data:text/html,<h1 id='t'>start</h1>",
	});
	if (!opened.ok) throw new Error(opened.error);

	const status = await statusTool.execute({ sessionId: opened.sessionId });
	if (!status.ok || !("pages" in status)) throw new Error("expected pages");
	const pageId = status.pages[0].pageId;

	const first = await execTool.execute({
		sessionId: opened.sessionId,
		code:
			"await page.locator('#t').evaluate((el: HTMLElement) => { el.textContent = 'first'; });",
	});
	expect(first).toMatchObject({ ok: true });
	expect(first.ok && first.snapshotDiff.length).toBeGreaterThan(0);

	const second = await execTool.execute({
		sessionId: opened.sessionId,
		pageId,
		code:
			"await page.locator('#t').evaluate((el: HTMLElement) => { el.textContent = 'second'; });",
	});
	expect(second).toMatchObject({ ok: true });
	expect(second.ok && second.snapshotDiff.length).toBeGreaterThan(0);

	const third = await execTool.execute({
		sessionId: opened.sessionId,
		code: "return await page.locator('#t').textContent()",
	});
	expect(third).toMatchObject({
		ok: true,
		result: "second",
		snapshotDiff: "",
	});
});

test("browser_exec returns ok false for a stale page ID", async ({
	openTool,
	execTool,
}) => {
	const opened = await openTool.execute({
		url: "data:text/html,<title>stale-page</title>",
	});
	if (!opened.ok) throw new Error(opened.error);

	const result = await execTool.execute({
		sessionId: opened.sessionId,
		pageId: "page-nope",
		code: "return page.title()",
	});
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.error).toMatch(/page-nope/);
	expect(result.error).toMatch(/browser_status/);
});

test("browser_snapshot returns ok false for a stale page ID", async ({
	openTool,
	snapshotTool,
}) => {
	const opened = await openTool.execute({
		url: "data:text/html,<title>stale-page</title>",
	});
	if (!opened.ok) throw new Error(opened.error);

	const result = await snapshotTool.execute({
		sessionId: opened.sessionId,
		pageId: "page-nope",
	});
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.error).toMatch(/page-nope/);
	expect(result.error).toMatch(/browser_status/);
});
