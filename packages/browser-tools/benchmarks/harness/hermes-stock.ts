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
	usageFromHermesHome,
	writeTextFile,
} from "./host-agent.js";

/**
 * Hermes with its stock built-in browser toolset (no Libretto MCP).
 */
export async function runHermesStockHarness(
	task: string,
	workspace: string,
	_provider: BrowserProviderName,
): Promise<HarnessRun> {
	const hermesBin = requireCommandOnPath("hermes");
	const openAiKey = requireOpenAiApiKey();
	const hermesHome = join(workspace, "hermes-home");
	const prompt = hostTaskPrompt(task, "stock");

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
			"",
		].join("\n"),
	);
	await writeTextFile(
		join(hermesHome, ".env"),
		`OPENAI_API_KEY=${openAiKey}\n`,
	);

	const result = await runHostProcess({
		command: hermesBin,
		args: ["chat", "-q", prompt],
		cwd: workspace,
		env: {
			...process.env,
			HOME: hermesHome,
			HERMES_HOME: hermesHome,
			OPENAI_API_KEY: openAiKey,
		},
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
		browserBackend: "host-stock",
		async dispose() {},
	};
	if (result.timedOut) {
		throw new HarnessRunError(
			new Error(
				`Hermes stock harness timed out after ${result.durationMs}ms.`,
			),
			run,
		);
	}
	if (!answer) {
		throw new HarnessRunError(
			new Error("Hermes stock harness returned no final answer."),
			run,
		);
	}
	return run;
}
