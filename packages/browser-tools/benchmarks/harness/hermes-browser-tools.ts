import { join } from "node:path";
import {
	HarnessRunError,
	type HarnessRun,
} from "../harness-run.js";
import type { BrowserProviderName } from "./cloud-browser.js";
import {
	extractHostAnswer,
	hostEventsFromProcess,
	hostMetrics,
	hostTaskPrompt,
	mcpProviderArgs,
	requireBrowserToolsMcpBinary,
	requireCommandOnPath,
	requireOpenAiApiKey,
	requireProviderApiKey,
	runHostProcess,
	usageFromHermesHome,
	writeTextFile,
} from "./host-agent.js";

/**
 * Hermes with Libretto Browser Tools MCP; stock Hermes browser toolset disabled.
 */
export async function runHermesBrowserToolsHarness(
	task: string,
	workspace: string,
	provider: BrowserProviderName,
): Promise<HarnessRun> {
	const hermesBin = requireCommandOnPath("hermes");
	const openAiKey = requireOpenAiApiKey();
	const providerKey = requireProviderApiKey(provider);
	const mcpBinary = requireBrowserToolsMcpBinary();
	const hermesHome = join(workspace, "hermes-home");
	const prompt = hostTaskPrompt(task, "mcp");
	const providerArgs = mcpProviderArgs(provider)
		.map((arg) => `      - ${JSON.stringify(arg)}`)
		.join("\n");

	const envLines = [`OPENAI_API_KEY=${openAiKey}`];
	const mcpEnvEntries: string[] = [];
	if (provider === "kernel" && providerKey) {
		envLines.push(`KERNEL_API_KEY=${providerKey}`);
		mcpEnvEntries.push(`      KERNEL_API_KEY: ${JSON.stringify(providerKey)}`);
	} else if (provider === "browserbase" && providerKey) {
		envLines.push(`BROWSERBASE_API_KEY=${providerKey}`);
		mcpEnvEntries.push(
			`      BROWSERBASE_API_KEY: ${JSON.stringify(providerKey)}`,
		);
	} else if (provider === "browser-use" && providerKey) {
		envLines.push(`BROWSER_USE_API_KEY=${providerKey}`);
		mcpEnvEntries.push(
			`      BROWSER_USE_API_KEY: ${JSON.stringify(providerKey)}`,
		);
	} else if (provider === "steel" && providerKey) {
		envLines.push(`STEEL_API_KEY=${providerKey}`);
		mcpEnvEntries.push(`      STEEL_API_KEY: ${JSON.stringify(providerKey)}`);
	}

	await writeTextFile(
		join(hermesHome, "config.yaml"),
		[
			"model:",
			"  provider: openai-api",
			"  default: gpt-5.6-sol",
			"  base_url: https://api.openai.com/v1",
			"agent:",
			"  reasoning_effort: none",
			"  supports_parallel_tool_calls: false",
			"  disabled_toolsets:",
			"    - browser",
			"mcp_servers:",
			"  libretto:",
			"    command: node",
			"    args:",
			`      - ${JSON.stringify(mcpBinary)}`,
			providerArgs,
			...(mcpEnvEntries.length > 0
				? ["    env:", ...mcpEnvEntries]
				: []),
			"",
		].join("\n"),
	);
	await writeTextFile(join(hermesHome, ".env"), `${envLines.join("\n")}\n`);

	const childEnv: NodeJS.ProcessEnv = {
		...process.env,
		HOME: hermesHome,
		HERMES_HOME: hermesHome,
		OPENAI_API_KEY: openAiKey,
	};
	if (providerKey) {
		const keyName =
			provider === "kernel"
				? "KERNEL_API_KEY"
				: provider === "browserbase"
					? "BROWSERBASE_API_KEY"
					: provider === "browser-use"
						? "BROWSER_USE_API_KEY"
						: provider === "steel"
							? "STEEL_API_KEY"
							: null;
		if (keyName) childEnv[keyName] = providerKey;
	}

	const result = await runHostProcess({
		command: hermesBin,
		args: ["chat", "-q", prompt],
		cwd: workspace,
		env: childEnv,
	});
	const answer = extractHostAnswer(result.stdout, result.stderr);
	const events = hostEventsFromProcess({ prompt, result, answer });
	const run: HarnessRun = {
		answer,
		events,
		metrics: hostMetrics(result.durationMs, {
			events,
			usage: usageFromHermesHome(hermesHome),
		}),
		browserBackend: "benchmark-provider",
		async dispose() {},
	};
	if (result.timedOut) {
		throw new HarnessRunError(
			new Error(
				`Hermes Browser Tools harness timed out after ${result.durationMs}ms.`,
			),
			run,
		);
	}
	if (!answer) {
		throw new HarnessRunError(
			new Error("Hermes Browser Tools harness returned no final answer."),
			run,
		);
	}
	return run;
}
