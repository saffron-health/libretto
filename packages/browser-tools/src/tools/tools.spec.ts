import { expect, test as base } from "vitest";
import { LocalBrowserProvider } from "../providers/local.js";
import { SessionRegistry } from "../session-registry.js";
import { createCloseTool } from "./close.js";
import { createExecTool } from "./exec.js";
import { createOpenTool } from "./open.js";
import { createStatusTool } from "./status.js";

const test = base.extend<{
	registry: SessionRegistry;
	openTool: ReturnType<typeof createOpenTool>;
	execTool: ReturnType<typeof createExecTool>;
	statusTool: ReturnType<typeof createStatusTool>;
	closeTool: ReturnType<typeof createCloseTool>;
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
});

test("browser_open navigates to a url and returns a session ID", async ({
	openTool,
}) => {
	const result = await openTool.execute({
		url: "data:text/html,<title>hello</title>",
	});
	expect(result).toEqual({ ok: true, sessionId: expect.any(String) });
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

	const sessionOnly = await statusTool.execute({ sessionId: opened.sessionId });
	expect(sessionOnly).toMatchObject({
		ok: true,
		pages: [{ pageId: expect.any(String), url: expect.any(String), active: true }],
	});
	if (!sessionOnly.ok || !("pages" in sessionOnly)) throw new Error("expected pages");

	const pageOnly = await statusTool.execute({
		sessionId: opened.sessionId,
		pageId: sessionOnly.pages[0].pageId,
	});
	expect(pageOnly).toMatchObject({
		ok: true,
		pageId: sessionOnly.pages[0].pageId,
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
