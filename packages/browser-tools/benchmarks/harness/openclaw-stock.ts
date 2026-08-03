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
	requireCommandOnPath,
	requireOpenAiApiKey,
	runHostProcess,
	writeTextFile,
} from "./host-agent.js";

/**
 * OpenClaw with its stock bundled browser plugin (no Libretto MCP).
 */
export async function runOpenclawStockHarness(
	task: string,
	workspace: string,
	_provider: BrowserProviderName,
): Promise<HarnessRun> {
	const openclawBin = requireCommandOnPath("openclaw");
	const openAiKey = requireOpenAiApiKey();
	const openclawHome = join(workspace, "openclaw-home");
	const configDir = join(openclawHome, ".openclaw");
	const prompt = hostTaskPrompt(task, "stock");
	const model = "openai/gpt-5.6-sol";

	await writeTextFile(
		join(configDir, "openclaw.json"),
		`${JSON.stringify(
			{
				plugins: {
					entries: {
						browser: { enabled: true },
					},
				},
				agents: {
					defaults: {
						model,
					},
				},
			},
			null,
			2,
		)}\n`,
	);

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
		env: {
			...process.env,
			HOME: openclawHome,
			OPENAI_API_KEY: openAiKey,
			OPENCLAW_HOME: openclawHome,
			OPENCLAW_STATE_DIR: configDir,
		},
	});
	const answer = extractHostAnswer(result.stdout, result.stderr);
	const run: HarnessRun = {
		answer,
		events: hostEventsFromProcess({ prompt, result, answer }),
		metrics: hostMetrics(result.durationMs),
		browserBackend: "host-stock",
		async dispose() {},
	};
	if (result.timedOut) {
		throw new HarnessRunError(
			new Error(
				`OpenClaw stock harness timed out after ${result.durationMs}ms.`,
			),
			run,
		);
	}
	if (!answer) {
		throw new HarnessRunError(
			new Error("OpenClaw stock harness returned no final answer."),
			run,
		);
	}
	return run;
}
