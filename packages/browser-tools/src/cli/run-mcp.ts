import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerMcpBrowserTools } from "../adapters/mcp/index.js";
import {
	createCliBrowserProvider,
	providerSupportsHeadless,
} from "./create-cli-provider.js";
import type { McpCliOptions } from "./parse-args.js";

const require = createRequire(fileURLToPath(import.meta.url));

function readPackageVersion(): string {
	try {
		const pkg = require("../../package.json") as { version?: string };
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

/**
 * Start the stdio MCP server and keep the process alive until the transport
 * closes or the process receives SIGINT/SIGTERM.
 */
export async function startMcpStdioServer(
	options: McpCliOptions,
): Promise<Error | void> {
	const provider = createCliBrowserProvider({
		provider: options.provider,
		headless: options.headless,
	});
	if (provider instanceof Error) {
		return provider;
	}

	if (!options.headless && !providerSupportsHeadless(options.provider)) {
		process.stderr.write(
			`--headed is ignored for --provider ${options.provider}; that provider has no headed mode in this CLI.\n`,
		);
	}

	const server = new McpServer({
		name: "libretto-browser-tools",
		version: readPackageVersion(),
	});
	const toolkit = registerMcpBrowserTools(server, provider, {
		allowedDomains:
			options.allowedDomains.length > 0 ? options.allowedDomains : undefined,
		blockedDomains:
			options.blockedDomains.length > 0 ? options.blockedDomains : undefined,
	});

	let shuttingDown = false;
	async function shutdown(): Promise<void> {
		if (shuttingDown) return;
		shuttingDown = true;
		await server.close().catch(() => undefined);
		await toolkit.dispose();
	}

	process.once("SIGINT", () => {
		void shutdown().finally(() => process.exit(0));
	});
	process.once("SIGTERM", () => {
		void shutdown().finally(() => process.exit(0));
	});

	const transport = new StdioServerTransport();
	transport.onclose = () => {
		void shutdown().finally(() => {
			if (!process.exitCode) process.exit(0);
		});
	};
	await server.connect(transport);
}
