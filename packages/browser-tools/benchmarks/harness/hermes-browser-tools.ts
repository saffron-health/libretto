import { join } from "node:path";
import {
	HarnessRunError,
	type HarnessRun,
} from "../harness-run.js";
import type { BrowserProviderName } from "./cloud-browser.js";
import {
	extractHostAnswer,
	hermesIsolatedEnv,
	hostEventsFromProcess,
	hostMetrics,
	hostTaskPrompt,
	mcpProviderArgs,
	playwrightBrowsersPath,
	playwrightBrowsersPathEnv,
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
	const playwrightBrowsersPathValue = playwrightBrowsersPath();

	const envLines = [`OPENAI_API_KEY=${openAiKey}`];
	const mcpEnvEntries: string[] = [
		`      PLAYWRIGHT_BROWSERS_PATH: ${JSON.stringify(playwrightBrowsersPathValue)}`,
	];
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
			"    env:",
			...mcpEnvEntries,
			"",
		].join("\n"),
	);
	await writeTextFile(join(hermesHome, ".env"), `${envLines.join("\n")}\n`);

	const providerEnv: NodeJS.ProcessEnv = {
		OPENAI_API_KEY: openAiKey,
		PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPathValue,
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
		if (keyName) providerEnv[keyName] = providerKey;
	}

	const result = await runHostProcess({
		command: hermesBin,
		args: ["chat", "-q", prompt],
		cwd: workspace,
		env: hermesIsolatedEnv(hermesHome, providerEnv),
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
