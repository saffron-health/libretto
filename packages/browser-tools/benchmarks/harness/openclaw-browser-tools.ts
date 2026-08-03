import { join } from "node:path";
import {
	HarnessRunError,
	type HarnessRun,
} from "../harness-run.js";
import type { BrowserProviderName } from "./cloud-browser.js";
import {
	extractHostAnswer,
	hostEventsFromOpenClawHome,
	hostMetrics,
	hostTaskPrompt,
	mcpProviderArgs,
	OPENCLAW_AGENT_DONE,
	requireBrowserToolsMcpBinary,
	requireCommandOnPath,
	requireOpenAiApiKey,
	requireProviderApiKey,
	runHostProcess,
	writeTextFile,
} from "./host-agent.js";

/**
 * OpenClaw with Libretto Browser Tools MCP; bundled browser plugin disabled.
 */
export async function runOpenclawBrowserToolsHarness(
	task: string,
	workspace: string,
	provider: BrowserProviderName,
): Promise<HarnessRun> {
	const openclawBin = requireCommandOnPath("openclaw");
	const openAiKey = requireOpenAiApiKey();
	const providerKey = requireProviderApiKey(provider);
	const mcpBinary = requireBrowserToolsMcpBinary();
	const openclawHome = join(workspace, "openclaw-home");
	const configDir = join(openclawHome, ".openclaw");
	const prompt = hostTaskPrompt(task, "mcp");
	const model = "openai/gpt-5.6-sol";

	const mcpEnv: Record<string, string> = {};
	if (provider === "kernel" && providerKey) {
		mcpEnv.KERNEL_API_KEY = providerKey;
	} else if (provider === "browserbase" && providerKey) {
		mcpEnv.BROWSERBASE_API_KEY = providerKey;
	} else if (provider === "browser-use" && providerKey) {
		mcpEnv.BROWSER_USE_API_KEY = providerKey;
	} else if (provider === "steel" && providerKey) {
		mcpEnv.STEEL_API_KEY = providerKey;
	}

	await writeTextFile(
		join(configDir, "openclaw.json"),
		`${JSON.stringify(
			{
				browser: {
					enabled: false,
					headless: true,
					noSandbox: true,
				},
				plugins: {
					entries: {
						browser: { enabled: false },
					},
				},
				agents: {
					defaults: {
						model,
						models: {
							[model]: {
								agentRuntime: { id: "openclaw" },
							},
						},
					},
				},
				mcp: {
					servers: {
						libretto: {
							command: "node",
							args: [mcpBinary, ...mcpProviderArgs(provider)],
							...(Object.keys(mcpEnv).length > 0 ? { env: mcpEnv } : {}),
						},
					},
				},
			},
			null,
			2,
		)}\n`,
	);

	const childEnv: NodeJS.ProcessEnv = {
		...process.env,
		HOME: openclawHome,
		OPENAI_API_KEY: openAiKey,
		OPENCLAW_HOME: openclawHome,
		OPENCLAW_STATE_DIR: configDir,
		OPENCLAW_BROWSER_HEADLESS: "1",
		...mcpEnv,
	};

	const result = await runHostProcess({
		command: openclawBin,
		args: [
			"agent",
			"--local",
			"--agent",
			"main",
			"--model",
			model,
			"--thinking",
			"off",
			"--message",
			prompt,
		],
		cwd: workspace,
		env: childEnv,
		exitOnStdoutMatch: OPENCLAW_AGENT_DONE,
		alsoKillCwdContains: openclawHome,
	});
	const answer = extractHostAnswer(result.stdout, result.stderr);
	const run: HarnessRun = {
		answer,
		events: hostEventsFromOpenClawHome({
			openclawHome,
			prompt,
			result,
			answer,
		}),
		metrics: hostMetrics(result.durationMs),
		browserBackend: "benchmark-provider",
		async dispose() {},
	};
	if (result.timedOut) {
		throw new HarnessRunError(
			new Error(
				`OpenClaw Browser Tools harness timed out after ${result.durationMs}ms.`,
			),
			run,
		);
	}
	if (!answer) {
		throw new HarnessRunError(
			new Error("OpenClaw Browser Tools harness returned no final answer."),
			run,
		);
	}
	return run;
}
