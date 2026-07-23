import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { expect, test as base } from "vitest";
import { DomainPolicyRestricted } from "../../domain-policy.js";
import { LocalBrowserProvider } from "../../providers/local.js";
import {
	createPiBrowserTools,
	type PiBrowserToolkit,
} from "./index.js";

type PiToolResult = {
	content: Array<
		{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
	>;
	details: unknown;
};

async function callTool(
	tools: ToolDefinition[],
	name: string,
	input: Record<string, unknown>,
): Promise<PiToolResult> {
	const tool = tools.find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`Tool ${name} is not registered`);
	const execute = tool.execute as unknown as (
		toolCallId: string,
		params: Record<string, unknown>,
	) => Promise<PiToolResult>;
	return await execute("call-1", input);
}

const test = base.extend<{ toolkit: PiBrowserToolkit }>({
	toolkit: async ({}, use) => {
		const toolkit = createPiBrowserTools(
			new LocalBrowserProvider({ headless: true }),
		);
		await use(toolkit);
		await toolkit.dispose();
	},
});

test("createPiBrowserTools exposes all six browser tools", ({ toolkit }) => {
	expect(toolkit.tools.map((tool) => tool.name).sort()).toEqual([
		"browser_close",
		"browser_connect",
		"browser_exec",
		"browser_open",
		"browser_snapshot",
		"browser_status",
	]);
});

test("Pi tools open a browser and execute Playwright code", async ({
	toolkit,
}) => {
	const opened = await callTool(toolkit.tools, "browser_open", {
		url: "data:text/html,<title>hello</title>",
	});
	expect(opened.details).toMatchObject({
		ok: true,
		sessionId: expect.any(String),
	});
	const sessionId = (opened.details as { sessionId: string }).sessionId;

	const executed = await callTool(toolkit.tools, "browser_exec", {
		sessionId,
		code: "return await page.title();",
	});
	expect(executed.details).toMatchObject({ ok: true, result: "hello" });
});

test("Pi snapshots carry screenshots as image content", async ({ toolkit }) => {
	const opened = await callTool(toolkit.tools, "browser_open", {
		url: "data:text/html,<main>hello</main>",
	});
	const sessionId = (opened.details as { sessionId: string }).sessionId;

	const snapshot = await callTool(toolkit.tools, "browser_snapshot", {
		sessionId,
		screenshot: true,
	});
	expect(snapshot.content).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ type: "text" }),
			expect.objectContaining({
				type: "image",
				mimeType: "image/png",
				data: expect.any(String),
			}),
		]),
	);
});

test("createPiBrowserTools forwards domain policy options", async () => {
	const toolkit = createPiBrowserTools(
		new LocalBrowserProvider({ headless: true }),
		{ blockedDomains: ["example.com"] },
	);
	await expect(
		callTool(toolkit.tools, "browser_open", {
			url: "https://example.com/",
		}),
	).rejects.toBeInstanceOf(DomainPolicyRestricted);
	await toolkit.dispose();
});
