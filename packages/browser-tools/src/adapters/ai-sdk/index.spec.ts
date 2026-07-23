import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ToolSet } from "ai";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { expect, test as base } from "vitest";
import { DomainPolicyRestricted } from "../../domain-policy.js";
import { LocalBrowserProvider } from "../../providers/local.js";
import {
	createAiSdkBrowserTools,
	createAiSdkBrowserToolsForPage,
} from "./index.js";

type Toolkit = ReturnType<typeof createAiSdkBrowserTools>;

const toolCallOptions = { toolCallId: "call-1", messages: [] };

async function callTool(
	tools: ToolSet,
	name: string,
	input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const toolDef = tools[name];
	if (!toolDef?.execute) throw new Error(`Tool ${name} is not executable`);
	const result = (await toolDef.execute(input, toolCallOptions)) as unknown;
	return result as Record<string, unknown>;
}

async function openSession(tools: ToolSet, url: string): Promise<string> {
	const result = await callTool(tools, "browser_open", { url });
	expect(result).toMatchObject({ ok: true });
	return result.sessionId as string;
}

const test = base.extend<{ toolkit: Toolkit }>({
	toolkit: async ({}, use) => {
		const toolkit = createAiSdkBrowserTools(
			new LocalBrowserProvider({ headless: true }),
		);
		await use(toolkit);
		const disposed = await toolkit.dispose();
		if (disposed instanceof Error) throw disposed;
	},
});

const borrowedPageTest = base.extend<{
	browser: Browser;
	page: Page;
	protectedServer: { origin: string; requestCount(): number };
}>({
	browser: async ({}, use) => {
		const browser = await chromium.launch({ headless: true });
		await use(browser);
		await browser.close();
	},
	page: async ({ browser }, use) => {
		const context = await browser.newContext();
		const page = await context.newPage();
		await use(page);
		await context.close();
	},
	protectedServer: async ({}, use) => {
		let requests = 0;
		const server = createServer((request, response) => {
			requests += 1;
			const authenticated = request.headers.cookie?.includes("session=valid");
			response.writeHead(authenticated ? 200 : 401, {
				"content-type": "text/html",
			});
			response.end(
				authenticated
					? "<main><h1>Protected dashboard</h1></main>"
					: "<main><h1>Sign in required</h1></main>",
			);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address() as AddressInfo;
		await use({
			origin: `http://127.0.0.1:${address.port}`,
			requestCount: () => requests,
		});
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	},
});

test("createAiSdkBrowserTools exposes all six browser tools", ({
	toolkit,
}) => {
	expect(Object.keys(toolkit.tools).sort()).toEqual([
		"browser_close",
		"browser_connect",
		"browser_exec",
		"browser_open",
		"browser_snapshot",
		"browser_status",
	]);
});

borrowedPageTest(
	"borrowed tools operate on the exact supplied page with its in-memory state",
	async ({ page }) => {
		await page.setContent(
			'<input id="draft" value="unsaved"><script>window.debugMarker = "failed-page";</script>',
		);
		const otherPage = await page.context().newPage();
		await otherPage.setContent("<title>newer unrelated tab</title>");

		const toolkit = createAiSdkBrowserToolsForPage(page);
		expect(Object.keys(toolkit.tools).sort()).toEqual([
			"browser_exec",
			"browser_snapshot",
			"browser_status",
		]);
		const result = await callTool(toolkit.tools, "browser_exec", {
			sessionId: toolkit.sessionId,
			code:
				"return await page.evaluate(() => ({ marker: window.debugMarker, " +
				"draft: document.querySelector('#draft')?.value }));",
		});

		expect(result).toMatchObject({
			ok: true,
			result: { marker: "failed-page", draft: "unsaved" },
		});
		const disposed = await toolkit.dispose();
		if (disposed instanceof Error) throw disposed;
	},
);

borrowedPageTest(
	"borrowed tools retain authenticated state and do not close caller-owned Playwright objects",
	async ({ browser, page, protectedServer }) => {
		await page.context().addCookies([
			{
				name: "session",
				value: "valid",
				url: protectedServer.origin,
				httpOnly: true,
			},
		]);
		await page.goto(protectedServer.origin);
		await page.evaluate(() => localStorage.setItem("draft", "stateful-value"));

		const toolkit = createAiSdkBrowserToolsForPage(page);
		const snapshot = await callTool(toolkit.tools, "browser_snapshot", {
			sessionId: toolkit.sessionId,
		});
		expect(snapshot).toMatchObject({ ok: true });
		expect(String(snapshot.tree)).toContain("Protected dashboard");

		const state = await callTool(toolkit.tools, "browser_exec", {
			sessionId: toolkit.sessionId,
			code:
				"return { cookies: await context.cookies(), " +
				"draft: await page.evaluate(() => localStorage.getItem('draft')) };",
		});
		expect(state).toMatchObject({
			ok: true,
			result: {
				cookies: expect.arrayContaining([
					expect.objectContaining({ name: "session", value: "valid" }),
				]),
				draft: "stateful-value",
			},
		});
		expect(protectedServer.requestCount()).toBe(1);

		const disposed = await toolkit.dispose();
		if (disposed instanceof Error) throw disposed;
		expect(page.isClosed()).toBe(false);
		expect(browser.isConnected()).toBe(true);
		await page.locator("h1").evaluate((heading) => {
			heading.textContent = "Still usable";
		});
		expect(await page.locator("h1").textContent()).toBe("Still usable");
	},
);

test("browser_open with a data: URL returns a session ID", async ({
	toolkit,
}) => {
	const result = await callTool(toolkit.tools, "browser_open", {
		url: "data:text/html,<title>hello</title>",
	});
	expect(result).toMatchObject({ ok: true, sessionId: expect.any(String) });
});

test("createAiSdkBrowserTools forwards domain policy options", async () => {
	const toolkit = createAiSdkBrowserTools(
		new LocalBrowserProvider({ headless: true }),
		{ blockedDomains: ["example.com"] },
	);

	await expect(
		callTool(toolkit.tools, "browser_open", {
			url: "https://example.com/",
		}),
	).rejects.toBeInstanceOf(DomainPolicyRestricted);
	const disposed = await toolkit.dispose();
	if (disposed instanceof Error) throw disposed;
});

test("browser_exec runs Playwright code against the opened page", async ({
	toolkit,
}) => {
	const sessionId = await openSession(
		toolkit.tools,
		"data:text/html,<title>hello</title>",
	);
	const result = await callTool(toolkit.tools, "browser_exec", {
		sessionId,
		code: "return await page.title();",
	});
	expect(result).toMatchObject({ ok: true, result: "hello" });
});

test("browser state persists between exec calls", async ({ toolkit }) => {
	const sessionId = await openSession(
		toolkit.tools,
		`data:text/html,<title>start</title><button onclick="document.title='clicked'">go</button>`,
	);

	const click = await callTool(toolkit.tools, "browser_exec", {
		sessionId,
		code: 'await page.click("button");',
	});
	expect(click).toMatchObject({ ok: true });

	const title = await callTool(toolkit.tools, "browser_exec", {
		sessionId,
		code: "return await page.title();",
	});
	expect(title).toMatchObject({ ok: true, result: "clicked" });
});

test("browser_exec accepts TypeScript-annotated code", async ({ toolkit }) => {
	const sessionId = await openSession(
		toolkit.tools,
		"data:text/html,<title>ts</title>",
	);
	const result = await callTool(toolkit.tools, "browser_exec", {
		sessionId,
		code: "const title: string = await page.title(); return title.toUpperCase();",
	});
	expect(result).toMatchObject({ ok: true, result: "TS" });
});

test("exec code that throws returns ok: false with the message", async ({
	toolkit,
}) => {
	const sessionId = await openSession(
		toolkit.tools,
		"data:text/html,<title>boom</title>",
	);
	const result = await callTool(toolkit.tools, "browser_exec", {
		sessionId,
		code: 'throw new Error("boom");',
	});
	expect(result).toMatchObject({ ok: false });
	expect(result.error).toContain("boom");
});

test("browser_snapshot returns a text accessibility tree", async ({
	toolkit,
}) => {
	const sessionId = await openSession(
		toolkit.tools,
		"data:text/html,<main><a href='/x'>Docs</a></main>",
	);
	const result = await callTool(toolkit.tools, "browser_snapshot", {
		sessionId,
	});
	expect(result).toMatchObject({ ok: true });
	expect(result.tree).toMatch(/link ref="/);
	expect(String(result.tree)).toContain("Docs");
	expect(result.screenshot).toBeUndefined();
});

test("browser_snapshot returns PNG bytes when screenshot is true", async ({
	toolkit,
}) => {
	const sessionId = await openSession(
		toolkit.tools,
		"data:text/html,<title>shot</title>",
	);
	const result = await callTool(toolkit.tools, "browser_snapshot", {
		sessionId,
		screenshot: true,
	});
	expect(result).toMatchObject({ ok: true });
	const screenshot = result.screenshot as { base64: string; mimeType: string };
	expect(screenshot).toMatchObject({
		mimeType: "image/png",
		base64: expect.any(String),
	});
	expect(screenshot.base64.length).toBeGreaterThan(100);
});

test("unknown session ID returns ok: false mentioning the ID", async ({
	toolkit,
}) => {
	const result = await callTool(toolkit.tools, "browser_exec", {
		sessionId: "ses-nope",
		code: "return 1;",
	});
	expect(result).toMatchObject({ ok: false });
	expect(result.error).toContain("ses-nope");
	expect(result.error).toContain("browser_open");
});

test("browser_snapshot with unknown session ID returns ok: false", async ({
	toolkit,
}) => {
	const result = await callTool(toolkit.tools, "browser_snapshot", {
		sessionId: "ses-nope",
	});
	expect(result).toMatchObject({ ok: false });
	expect(result.error).toContain("ses-nope");
	expect(result.error).toContain("browser_open");
});

test("dispose closes open sessions", async ({ toolkit }) => {
	const sessionId = await openSession(
		toolkit.tools,
		"data:text/html,<title>bye</title>",
	);
	const disposed = await toolkit.dispose();
	if (disposed instanceof Error) throw disposed;

	const result = await callTool(toolkit.tools, "browser_exec", {
		sessionId,
		code: "return await page.title();",
	});
	expect(result).toMatchObject({ ok: false });
	expect(result.error).toContain(sessionId);
});
