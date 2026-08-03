import { spawn } from "node:child_process";
import { accessSync, constants, readdirSync, readFileSync, readlinkSync } from "node:fs";
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
	/** When stdout matches, stop waiting and kill the process tree. */
	exitOnStdoutMatch?: RegExp;
	/** Also SIGKILL processes whose cwd contains this path (orphaned helpers). */
	alsoKillCwdContains?: string;
}): Promise<HostProcessResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const startedMs = Date.now();
	return await new Promise<HostProcessResult>((resolvePromise, reject) => {
		const child = spawn(options.command, options.args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let timedOut = false;
		let settled = false;
		const killByCwdHint = (): void => {
			const hint = options.alsoKillCwdContains;
			if (!hint) return;
			try {
				const pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
				for (const pid of pids) {
					try {
						const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
						if (
							!cmdline.includes("openclaw-agent") &&
							!cmdline.includes("google-chrome")
						) {
							continue;
						}
						const cwd = readlinkSync(`/proc/${pid}/cwd`);
						if (!cwd.includes(hint)) continue;
						process.kill(Number(pid), "SIGKILL");
					} catch {
						// ignore vanishing procs / permission
					}
				}
			} catch {
				// ignore
			}
		};
		const killTree = (signal: NodeJS.Signals): void => {
			if (child.pid != null) {
				try {
					process.kill(-child.pid, signal);
				} catch {
					try {
						child.kill(signal);
					} catch {
						// already gone
					}
				}
			}
			if (signal === "SIGKILL") killByCwdHint();
		};
		const finish = (exitCode: number | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				child.stdout.destroy();
			} catch {
				// ignore
			}
			try {
				child.stderr.destroy();
			} catch {
				// ignore
			}
			resolvePromise({
				exitCode,
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				durationMs: Date.now() - startedMs,
				timedOut,
			});
		};
		const timer = setTimeout(() => {
			timedOut = true;
			killTree("SIGKILL");
			finish(null);
		}, timeoutMs);
		const maybeExitEarly = (): void => {
			if (!options.exitOnStdoutMatch) return;
			if (settled) return;
			const text =
				Buffer.concat(stdoutChunks).toString("utf8") +
				Buffer.concat(stderrChunks).toString("utf8");
			if (!options.exitOnStdoutMatch.test(text)) return;
			setTimeout(() => {
				if (settled) return;
				killTree("SIGTERM");
				setTimeout(() => {
					if (settled) return;
					killTree("SIGKILL");
					finish(child.exitCode);
				}, 1_500);
			}, 300);
		};
		child.stdout.on("data", (chunk: Buffer) => {
			stdoutChunks.push(chunk);
			process.stdout.write(chunk);
			maybeExitEarly();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
			process.stderr.write(chunk);
			maybeExitEarly();
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			if (settled) return;
			settled = true;
			reject(error);
		});
		child.once("exit", (exitCode) => {
			// OpenClaw's CLI wrapper can exit while openclaw-agent keeps stdio
			// open. When exitOnStdoutMatch is set, wait for that (or timeout).
			if (options.exitOnStdoutMatch) return;
			finish(exitCode);
		});
		child.once("close", (exitCode) => {
			finish(exitCode);
		});
	});
}

export const OPENCLAW_AGENT_DONE =
	/\[agents\/agent-command\] \[agent\] run \S+ ended with stopReason=/;

const HOST_OUTPUT_NOISE =
	/^(Query:|Initializing|Testing |Transport:|Auth:|✓|✗|┊|──|╭|╰|│|\[diagnostic\]|\[plugins\]|\[provider-|\[agent\/|\[agents\/|\[tools\]|\[browser\/|Resume this session|Session:|Duration:|Messages:|MCP doctor|Saved MCP|Removed MCP|Goodbye|hermes --resume\b)/;

/**
 * Prefer the Hermes chat reply box when present; otherwise the last non-noise
 * content line from host stdout/stderr.
 */
export function extractHostAnswer(stdout: string, stderr: string): string {
	const combined = `${stdout}\n${stderr}`;
	const hermesBox = combined.match(/╭─[^\n]*\n([\s\S]*?)\n╰─/);
	if (hermesBox?.[1]) {
		const boxed = hermesBox[1]
			.split(/\r?\n/)
			.map((line) => line.replace(/^\s*│\s?/, "").trimEnd())
			.join("\n")
			.trim();
		if (boxed) return boxed;
	}
	const lines = combined
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		const line = lines[i];
		if (!line || HOST_OUTPUT_NOISE.test(line)) continue;
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
	const hostLog = [options.result.stdout, options.result.stderr]
		.filter((part) => part.trim().length > 0)
		.join("\n");
	if (hostLog) {
		// Emit a synthetic tool span so the shared judge can treat host CLI
		// stdout/stderr as observed browser evidence (hosts do not emit Pi tool events).
		events.push({
			type: "tool_execution_start",
			toolName: "host_browser",
			args: { source: "host-cli" },
		});
		events.push({
			type: "tool_execution_end",
			toolName: "host_browser",
			isError:
				options.result.timedOut ||
				(options.result.exitCode !== 0 && options.result.exitCode !== null),
			result: hostLog,
		});
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

function textFromOpenClawContent(content: unknown): string | null {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return null;
	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const record = part as { type?: unknown; text?: unknown };
		if (record.type === "text" && typeof record.text === "string") {
			parts.push(record.text);
		}
	}
	return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Convert OpenClaw session JSONL (under OPENCLAW_STATE_DIR) into HarnessEvents
 * so the shared judge sees real tool calls instead of only process stdout.
 */
export function hostEventsFromOpenClawHome(options: {
	openclawHome: string;
	prompt: string;
	result: HostProcessResult;
	answer: string;
}): HarnessEvent[] {
	const sessionsDir = join(
		options.openclawHome,
		".openclaw",
		"agents",
		"main",
		"sessions",
	);
	let sessionFiles: string[] = [];
	try {
		sessionFiles = readdirSync(sessionsDir)
			.filter(
				(name) =>
					name.endsWith(".jsonl") &&
					!name.endsWith(".trajectory.jsonl") &&
					name !== "sessions.json",
			)
			.map((name) => join(sessionsDir, name));
	} catch {
		sessionFiles = [];
	}

	const events: HarnessEvent[] = [];
	for (const sessionFile of sessionFiles) {
		let lines: string[] = [];
		try {
			lines = readFileSync(sessionFile, "utf8").split(/\r?\n/);
		} catch {
			continue;
		}
		for (const line of lines) {
			if (!line.trim()) continue;
			let record: unknown;
			try {
				record = JSON.parse(line);
			} catch {
				continue;
			}
			if (!record || typeof record !== "object") continue;
			const entry = record as {
				type?: unknown;
				message?: {
					role?: unknown;
					content?: unknown;
					toolName?: unknown;
					isError?: unknown;
				};
			};
			if (entry.type !== "message" || !entry.message) continue;
			const message = entry.message;
			if (message.role === "user" || message.role === "assistant") {
				const text = textFromOpenClawContent(message.content);
				if (text) {
					events.push({
						type: "message",
						role: message.role,
						text,
					});
				}
				if (message.role === "assistant" && Array.isArray(message.content)) {
					for (const part of message.content) {
						if (!part || typeof part !== "object") continue;
						const toolCall = part as {
							type?: unknown;
							name?: unknown;
							arguments?: unknown;
						};
						if (toolCall.type !== "toolCall") continue;
						if (typeof toolCall.name !== "string") continue;
						events.push({
							type: "tool_execution_start",
							toolName: toolCall.name,
							args: toolCall.arguments,
						});
					}
				}
				continue;
			}
			if (message.role === "toolResult") {
				const toolName =
					typeof message.toolName === "string"
						? message.toolName
						: "tool";
				events.push({
					type: "tool_execution_end",
					toolName,
					isError: Boolean(message.isError),
					result: message.content,
				});
			}
		}
	}

	if (events.length === 0) {
		return hostEventsFromProcess({
			prompt: options.prompt,
			result: options.result,
			answer: options.answer,
		});
	}

	if (options.result.timedOut) {
		events.push({
			type: "error",
			message: `Host process timed out after ${options.result.durationMs}ms.`,
		});
	} else if (
		options.result.exitCode !== 0 &&
		options.result.exitCode !== null
	) {
		events.push({
			type: "error",
			message: `Host process exited with code ${options.result.exitCode}.`,
		});
	}

	const hasAssistantAnswer = events.some(
		(event) =>
			event.type === "message" &&
			event.role === "assistant" &&
			event.text.trim() === options.answer.trim(),
	);
	if (options.answer && !hasAssistantAnswer) {
		events.push({
			type: "message",
			role: "assistant",
			text: options.answer,
		});
	}
	return events;
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
