import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { createCliBrowserProvider } from "./create-cli-provider.js";
import { getHelpText, parseCliArgs } from "./parse-args.js";

const cliEntry = fileURLToPath(new URL("./index.ts", import.meta.url));
const tsxCli = fileURLToPath(
	new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url),
);

test("help text tells the user how to wire an MCP client", () => {
	const help = getHelpText();
	expect(help).toContain("libretto-browser-tools");
	expect(help).toContain('args ["-y", "libretto-browser-tools"]');
	expect(help).toContain("--provider");
	expect(help).toContain("kernel");
	expect(help).toContain("npx playwright install chromium");
});

test("parseCliArgs accepts bare invocation and mcp subcommand with domain flags", () => {
	expect(parseCliArgs([])).toEqual({
		kind: "mcp",
		options: {
			provider: "local",
			headless: true,
			allowedDomains: [],
			blockedDomains: [],
		},
	});
	expect(
		parseCliArgs(["mcp", "--headed", "--allowed-domain", "example.com"]),
	).toEqual({
		kind: "mcp",
		options: {
			provider: "local",
			headless: false,
			allowedDomains: ["example.com"],
			blockedDomains: [],
		},
	});
	expect(parseCliArgs(["--blocked-domain=ads.example.com"])).toEqual({
		kind: "mcp",
		options: {
			provider: "local",
			headless: true,
			allowedDomains: [],
			blockedDomains: ["ads.example.com"],
		},
	});
	expect(parseCliArgs(["--provider", "kernel"])).toEqual({
		kind: "mcp",
		options: {
			provider: "kernel",
			headless: true,
			allowedDomains: [],
			blockedDomains: [],
		},
	});
	expect(parseCliArgs(["--provider=libretto-cloud"])).toEqual({
		kind: "mcp",
		options: {
			provider: "libretto-cloud",
			headless: true,
			allowedDomains: [],
			blockedDomains: [],
		},
	});
});

test("parseCliArgs reports unknown flags and providers with recovery text", () => {
	const unknownFlag = parseCliArgs(["--wat"]);
	expect(unknownFlag).toMatchObject({
		kind: "error",
		message: "Unknown argument: --wat",
	});
	if (unknownFlag.kind === "error") {
		expect(unknownFlag.recovery).toContain("--help");
	}

	const unknownProvider = parseCliArgs(["--provider", "camofox"]);
	expect(unknownProvider).toMatchObject({
		kind: "error",
		message: "Unknown provider: camofox",
	});
	if (unknownProvider.kind === "error") {
		expect(unknownProvider.recovery).toContain("kernel");
	}
});

test("createCliBrowserProvider reports missing cloud credentials", () => {
	const previous = process.env.KERNEL_API_KEY;
	delete process.env.KERNEL_API_KEY;
	const provider = createCliBrowserProvider({
		provider: "kernel",
		headless: true,
	});
	if (previous === undefined) {
		delete process.env.KERNEL_API_KEY;
	} else {
		process.env.KERNEL_API_KEY = previous;
	}
	expect(provider).toBeInstanceOf(Error);
	if (!(provider instanceof Error)) {
		throw new Error("expected missing KERNEL_API_KEY to return Error");
	}
	expect(provider.message).toContain("KERNEL_API_KEY");
	expect(provider.message).toContain("--provider local");
});

test("stdio MCP binary lists tools and runs Playwright against a page", async () => {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [tsxCli, cliEntry, "--headless"],
		stderr: "pipe",
	});
	const client = new Client({
		name: "libretto-browser-tools-cli-test",
		version: "1.0.0",
	});
	await client.connect(transport);

	const listed = await client.listTools();
	expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
		"browser_close",
		"browser_connect",
		"browser_exec",
		"browser_open",
		"browser_snapshot",
		"browser_status",
	]);

	const opened = CallToolResultSchema.parse(
		await client.callTool({
			name: "browser_open",
			arguments: {
				url: "data:text/html,<title>hello from mcp cli</title>",
				authProfile: false,
			},
		}),
	);
	expect(opened.isError).not.toBe(true);
	const openText = opened.content.find((part) => part.type === "text");
	expect(openText?.type).toBe("text");
	if (openText?.type !== "text") {
		throw new Error("expected text content from browser_open");
	}
	const openPayload = JSON.parse(openText.text) as {
		ok: boolean;
		sessionId: string;
	};
	expect(openPayload).toMatchObject({ ok: true });

	const executed = CallToolResultSchema.parse(
		await client.callTool({
			name: "browser_exec",
			arguments: {
				sessionId: openPayload.sessionId,
				code: "return await page.title();",
			},
		}),
	);
	expect(executed.isError).not.toBe(true);
	const execText = executed.content.find((part) => part.type === "text");
	expect(execText?.type).toBe("text");
	if (execText?.type !== "text") {
		throw new Error("expected text content from browser_exec");
	}
	expect(JSON.parse(execText.text)).toMatchObject({
		ok: true,
		result: "hello from mcp cli",
	});

	await client.close();
});

test("--help prints usage on stderr without starting an MCP server", async () => {
	const child = spawn(process.execPath, [tsxCli, cliEntry, "--help"], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	const stderrChunks: Buffer[] = [];
	child.stderr.on("data", (chunk: Buffer) => {
		stderrChunks.push(chunk);
	});
	await new Promise<void>((resolve) => {
		child.once("close", () => resolve());
	});
	const stderr = Buffer.concat(stderrChunks).toString("utf8");
	expect(stderr).toContain("Start a stdio MCP server");
	expect(stderr).toContain('args ["-y", "libretto-browser-tools"]');
});
