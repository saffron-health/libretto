import type { ToolSet } from "ai";
import { expect, test as base } from "vitest";
import { LocalBrowserProvider } from "../../providers/local.js";
import { createAiSdkBrowserTools } from "./index.js";

interface Toolkit {
	tools: ToolSet;
	dispose(): Promise<void>;
}

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
		await toolkit.dispose();
	},
});

test("createAiSdkBrowserTools exposes browser_open and browser_exec", ({
	toolkit,
}) => {
	expect(Object.keys(toolkit.tools).sort()).toEqual([
		"browser_exec",
		"browser_open",
	]);
});

test("browser_open with a data: URL returns a session ID", async ({
	toolkit,
}) => {
	const result = await callTool(toolkit.tools, "browser_open", {
		url: "data:text/html,<title>hello</title>",
	});
	expect(result).toMatchObject({ ok: true, sessionId: expect.any(String) });
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

test("dispose closes open sessions", async ({ toolkit }) => {
	const sessionId = await openSession(
		toolkit.tools,
		"data:text/html,<title>bye</title>",
	);
	await toolkit.dispose();

	const result = await callTool(toolkit.tools, "browser_exec", {
		sessionId,
		code: "return await page.title();",
	});
	expect(result).toMatchObject({ ok: false });
	expect(result.error).toContain(sessionId);
});
