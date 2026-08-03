import {
	formatCliProviderList,
	isCliProviderName,
	type CliProviderName,
} from "./create-cli-provider.js";

export type McpCliOptions = {
	provider: CliProviderName;
	headless: boolean;
	allowedDomains: string[];
	blockedDomains: string[];
};

export type ParsedCli =
	| { kind: "help" }
	| { kind: "error"; message: string; recovery: string }
	| { kind: "mcp"; options: McpCliOptions };

const HELP = `Start a stdio MCP server that exposes Libretto browser tools.

Usage:
  libretto-browser-tools [mcp] [options]

Options:
  --provider <name>        Browser provider (default: local)
                           ${formatCliProviderList()}
  --headed                 Show the browser window (default: headless)
  --allowed-domain <host>  Allow http(s) navigation to this host (repeatable)
  --blocked-domain <host>  Block http(s) navigation to this host (repeatable)
  -h, --help               Show this help

Cloud providers read API keys from the environment (for example KERNEL_API_KEY).
--headed applies to local, kernel, and libretto-cloud.

Examples:
  npx -y libretto-browser-tools
  npx -y libretto-browser-tools mcp --headed
  npx -y libretto-browser-tools --provider kernel
  npx -y libretto-browser-tools --allowed-domain example.com

Configure an MCP client with command "npx" and args ["-y", "libretto-browser-tools"].
Install Chromium once for --provider local: npx playwright install chromium
`;

export function getHelpText(): string {
	return HELP;
}

function missingFlagValue(
	flag: string,
	example: string,
): Extract<ParsedCli, { kind: "error" }> {
	return {
		kind: "error",
		message: `Missing value for ${flag}.`,
		recovery: `Pass a value after the flag, for example \`${example}\`.`,
	};
}

/**
 * Parse CLI argv (without the node executable or script path).
 */
export function parseCliArgs(argv: readonly string[]): ParsedCli {
	const tokens = [...argv];
	if (tokens[0] === "mcp") {
		tokens.shift();
	}

	let provider: CliProviderName = "local";
	let headless = true;
	const allowedDomains: string[] = [];
	const blockedDomains: string[] = [];

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === undefined) break;

		if (token === "-h" || token === "--help" || token === "help") {
			return { kind: "help" };
		}

		if (token === "--headed") {
			headless = false;
			continue;
		}

		if (token === "--headless") {
			headless = true;
			continue;
		}

		if (token === "--provider") {
			const value = tokens[++i];
			if (value === undefined || value.startsWith("-")) {
				return missingFlagValue(
					"--provider",
					`--provider kernel`,
				);
			}
			if (!isCliProviderName(value)) {
				return {
					kind: "error",
					message: `Unknown provider: ${value}`,
					recovery: `Use one of: ${formatCliProviderList()}.`,
				};
			}
			provider = value;
			continue;
		}

		if (token.startsWith("--provider=")) {
			const value = token.slice("--provider=".length);
			if (value.length === 0) {
				return missingFlagValue(
					"--provider",
					`--provider=kernel`,
				);
			}
			if (!isCliProviderName(value)) {
				return {
					kind: "error",
					message: `Unknown provider: ${value}`,
					recovery: `Use one of: ${formatCliProviderList()}.`,
				};
			}
			provider = value;
			continue;
		}

		if (token === "--allowed-domain") {
			const value = tokens[++i];
			if (value === undefined || value.startsWith("-")) {
				return missingFlagValue(
					"--allowed-domain",
					`--allowed-domain example.com`,
				);
			}
			allowedDomains.push(value);
			continue;
		}

		if (token.startsWith("--allowed-domain=")) {
			const value = token.slice("--allowed-domain=".length);
			if (value.length === 0) {
				return missingFlagValue(
					"--allowed-domain",
					`--allowed-domain=example.com`,
				);
			}
			allowedDomains.push(value);
			continue;
		}

		if (token === "--blocked-domain") {
			const value = tokens[++i];
			if (value === undefined || value.startsWith("-")) {
				return missingFlagValue(
					"--blocked-domain",
					`--blocked-domain ads.example.com`,
				);
			}
			blockedDomains.push(value);
			continue;
		}

		if (token.startsWith("--blocked-domain=")) {
			const value = token.slice("--blocked-domain=".length);
			if (value.length === 0) {
				return missingFlagValue(
					"--blocked-domain",
					`--blocked-domain=ads.example.com`,
				);
			}
			blockedDomains.push(value);
			continue;
		}

		return {
			kind: "error",
			message: `Unknown argument: ${token}`,
			recovery:
				"Remove the unknown argument, or run `libretto-browser-tools --help` for usage.",
		};
	}

	return {
		kind: "mcp",
		options: { provider, headless, allowedDomains, blockedDomains },
	};
}
