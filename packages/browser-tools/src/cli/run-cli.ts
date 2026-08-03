import { getHelpText, parseCliArgs } from "./parse-args.js";
import { startMcpStdioServer } from "./run-mcp.js";

/**
 * CLI entry used by the package bin. Writes help and errors to stderr so they
 * do not corrupt the MCP stdio protocol on stdout.
 */
export async function runCli(argv: readonly string[]): Promise<void> {
	const parsed = parseCliArgs(argv);

	if (parsed.kind === "help") {
		process.stderr.write(`${getHelpText()}\n`);
		return;
	}

	if (parsed.kind === "error") {
		process.stderr.write(
			`${parsed.message}\n${parsed.recovery}\n\n${getHelpText()}\n`,
		);
		process.exitCode = 1;
		return;
	}

	const started = await startMcpStdioServer(parsed.options);
	if (started instanceof Error) {
		process.stderr.write(
			`${started.message}\n\n${getHelpText()}\n`,
		);
		process.exitCode = 1;
	}
}
