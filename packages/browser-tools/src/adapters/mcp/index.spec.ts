import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect, test as base } from "vitest";
import { LocalBrowserProvider } from "../../providers/local.js";
import {
	registerMcpBrowserTools,
	type McpBrowserToolkit,
} from "./index.js";

type McpFixture = {
	client: Client;
	server: McpServer;
	toolkit: McpBrowserToolkit;
};

const test = base.extend<{ mcp: McpFixture }>({
	mcp: async ({}, use) => {
		const server = new McpServer({
			name: "libretto-browser-tools-test",
			version: "1.0.0",
		});
		const toolkit = registerMcpBrowserTools(
			server,
			new LocalBrowserProvider({ headless: true }),
		);
		const client = new Client({
			name: "libretto-browser-tools-test-client",
			version: "1.0.0",
		});
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		await client.connect(clientTransport);

		await use({ client, server, toolkit });

		await client.close();
		await server.close();
		await toolkit.dispose();
	},
});

test("MCP clients discover all six browser tools with safety annotations", async ({
	mcp,
}) => {
	const listed = await mcp.client.listTools();

	expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
		"browser_close",
		"browser_connect",
		"browser_exec",
		"browser_open",
		"browser_snapshot",
		"browser_status",
	]);
	expect(
		listed.tools.find((tool) => tool.name === "browser_snapshot")?.annotations,
	).toMatchObject({
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	});
	expect(
		listed.tools.find((tool) => tool.name === "browser_exec")?.annotations,
	).toMatchObject({
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	});
});

test("MCP clients can open a browser and run Playwright against it", async ({
	mcp,
}) => {
	const opened = await mcp.client.callTool({
		name: "browser_open",
		arguments: { url: "data:text/html,<title>hello from mcp</title>" },
	});
	if (!("content" in opened)) throw new Error("Expected an MCP tool result");
	const openedText = opened.content.find((content) => content.type === "text");
	if (openedText?.type !== "text") throw new Error("Expected text content");
	const openedDetails = JSON.parse(openedText.text) as {
		ok: boolean;
		sessionId: string;
	};
	expect(openedDetails).toMatchObject({
		ok: true,
		sessionId: expect.any(String),
	});

	const executed = await mcp.client.callTool({
		name: "browser_exec",
		arguments: {
			sessionId: openedDetails.sessionId,
			code: "return await page.title();",
		},
	});
	if (!("content" in executed)) throw new Error("Expected an MCP tool result");
	const executedText = executed.content.find(
		(content) => content.type === "text",
	);
	if (executedText?.type !== "text") throw new Error("Expected text content");
	expect(JSON.parse(executedText.text)).toMatchObject({
		ok: true,
		result: "hello from mcp",
	});
});

test("MCP snapshots return screenshots as image content", async ({ mcp }) => {
	const opened = await mcp.client.callTool({
		name: "browser_open",
		arguments: { url: "data:text/html,<main>hello</main>" },
	});
	if (!("content" in opened)) throw new Error("Expected an MCP tool result");
	const openedText = opened.content.find((content) => content.type === "text");
	if (openedText?.type !== "text") throw new Error("Expected text content");
	const { sessionId } = JSON.parse(openedText.text) as { sessionId: string };

	const snapshot = await mcp.client.callTool({
		name: "browser_snapshot",
		arguments: { sessionId, screenshot: true },
	});
	if (!("content" in snapshot)) throw new Error("Expected an MCP tool result");
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

test("MCP tool failures set isError and give the agent a next step", async ({
	mcp,
}) => {
	const result = await mcp.client.callTool({
		name: "browser_exec",
		arguments: {
			sessionId: "ses-missing",
			code: "return await page.title();",
		},
	});
	if (!("content" in result)) throw new Error("Expected an MCP tool result");
	const text = result.content.find((content) => content.type === "text");
	if (text?.type !== "text") throw new Error("Expected text content");

	expect(result.isError).toBe(true);
	expect(text.text).toContain("ses-missing");
	expect(text.text).toContain("browser_open");
});
