import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	browserTaskPrompt,
	DEFAULT_TIMEOUT_MS,
	MODEL_SELECTOR,
	type BrowserToolGuidance,
	type UsageMetrics,
} from "../agent.js";
import type { HarnessEvent, HarnessRun } from "../harness-run.js";
import type { BrowserProviderName } from "./cloud-browser.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function browserToolsMcpBinaryPath(): string {
	return join(packageRoot, "dist", "cli", "index.js");
}

export function requireBrowserToolsMcpBinary(): string {
	const path = browserToolsMcpBinaryPath();
	try {
		accessSync(path, constants.R_OK);
	} catch {
		throw new Error(
			`Missing Browser Tools MCP binary at ${path}. Run \`pnpm --filter libretto-browser-tools build\`, then rerun the benchmark.`,
		);
	}
	return path;
}

export function requireCommandOnPath(command: string): string {
	const pathDirs = (process.env.PATH ?? "").split(":");
	for (const dir of pathDirs) {
		if (!dir) continue;
		const candidate = join(dir, command);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// try next
		}
	}
	throw new Error(
		`\`${command}\` was not found on PATH. Install it, ensure PATH includes its bin directory, then rerun with the host harness selected.`,
	);
}

export function requireOpenAiApiKey(): string {
	const value = process.env.OPENAI_API_KEY?.trim();
	if (!value) {
		throw new Error(
			"OPENAI_API_KEY is required for Hermes/OpenClaw host harnesses. Set it in the environment or repo .env, then rerun.",
		);
	}
	return value;
}

export function providerApiKeyEnvName(
	provider: BrowserProviderName,
): string | null {
	switch (provider) {
		case "kernel":
			return "KERNEL_API_KEY";
		case "browserbase":
			return "BROWSERBASE_API_KEY";
		case "browser-use":
			return "BROWSER_USE_API_KEY";
		case "steel":
			return "STEEL_API_KEY";
		case "local":
			return null;
	}
}

export function requireProviderApiKey(
	provider: BrowserProviderName,
): string | undefined {
	const envName = providerApiKeyEnvName(provider);
	if (!envName) return undefined;
	const value = process.env[envName]?.trim();
	if (!value) {
		throw new Error(
			`${envName} is required for --provider ${provider} with Browser Tools MCP. Set it, then rerun.`,
		);
	}
	return value;
}

export type HostProcessResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
	timedOut: boolean;
};

export async function runHostProcess(options: {
	command: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs?: number;
}): Promise<HostProcessResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const startedMs = Date.now();
	return await new Promise<HostProcessResult>((resolvePromise, reject) => {
		const child = spawn(options.command, options.args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);
		child.stdout.on("data", (chunk: Buffer) => {
			stdoutChunks.push(chunk);
			process.stdout.write(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
			process.stderr.write(chunk);
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", (exitCode) => {
			clearTimeout(timer);
			resolvePromise({
				exitCode,
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				durationMs: Date.now() - startedMs,
				timedOut,
			});
		});
	});
}

/**
 * Pull a final answer from host CLI output. Prefer the last non-empty line that
 * looks like content rather than progress chrome.
 */
export function extractHostAnswer(stdout: string, stderr: string): string {
	const combined = `${stdout}\n${stderr}`;
	const lines = combined
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const ignored = /^(Query:|Initializing|Testing |Transport:|Auth:|✓|✗|┊|──|╭|╰|\[diagnostic\]|\[plugins\]|\[provider-|\[agent\/|\[agents\/|Resume this session|Session:|Duration:|Messages:|MCP doctor|Saved MCP|Removed MCP|Goodbye)/;
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		const line = lines[i];
		if (!line || ignored.test(line)) continue;
		if (line.startsWith("http://") || line.startsWith("https://")) continue;
		return line;
	}
	return lines.at(-1) ?? "";
}

export function hostEventsFromProcess(options: {
	prompt: string;
	result: HostProcessResult;
	answer: string;
}): HarnessEvent[] {
	const events: HarnessEvent[] = [
		{ type: "message", role: "user", text: options.prompt },
	];
	if (options.result.stdout.trim()) {
		events.push({
			type: "log",
			stream: "stdout",
			text: options.result.stdout,
		});
	}
	if (options.result.stderr.trim()) {
		events.push({
			type: "log",
			stream: "stderr",
			text: options.result.stderr,
		});
	}
	if (options.result.timedOut) {
		events.push({
			type: "error",
			message: `Host process timed out after ${options.result.durationMs}ms.`,
		});
	} else if (options.result.exitCode !== 0 && options.result.exitCode !== null) {
		events.push({
			type: "error",
			message: `Host process exited with code ${options.result.exitCode}.`,
		});
	}
	if (options.answer) {
		events.push({
			type: "message",
			role: "assistant",
			text: options.answer,
		});
	}
	return events;
}

export function hostMetrics(durationMs: number): UsageMetrics {
	return { durationMs };
}

export function hostTaskPrompt(
	task: string,
	guidance: Exclude<BrowserToolGuidance, "harness-provided">,
): string {
	return browserTaskPrompt({ task, guidance });
}

export async function writeTextFile(
	path: string,
	contents: string,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents, "utf8");
}

export function mcpProviderArgs(provider: BrowserProviderName): string[] {
	return ["--provider", provider];
}

export { MODEL_SELECTOR, packageRoot };
