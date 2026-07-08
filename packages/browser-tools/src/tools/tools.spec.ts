import { expect, test as base } from "vitest";
import { LocalBrowserProvider } from "../providers/local.js";
import { SessionRegistry } from "../session-registry.js";
import { createExecTool } from "./exec.js";
import { createOpenTool } from "./open.js";

const test = base.extend<{
	registry: SessionRegistry;
	openTool: ReturnType<typeof createOpenTool>;
	execTool: ReturnType<typeof createExecTool>;
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
	expect(result).toEqual({
		ok: true,
		result: "hello",
		stdout: "",
		stderr: "",
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
	expect(mutate).toEqual({
		ok: true,
		result: "updated",
		stdout: "mutated to updated",
		stderr: "",
	});

	const read = await execTool.execute({
		sessionId: opened.sessionId,
		code: "return await page.locator('#t').textContent()",
	});
	expect(read).toEqual({
		ok: true,
		result: "updated",
		stdout: "",
		stderr: "",
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
