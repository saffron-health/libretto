import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { KernelBrowserProvider } from "../../src/providers/kernel.js";
import {
	createPiSession,
	DEFAULT_TIMEOUT_MS,
	runPrompt,
	SessionRunError,
	type SessionRun,
} from "../agent.js";

const CLI_TIMEOUT_MS = 2 * 60_000;

export type CliCommandResult = {
	command: string;
	args: string[];
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
}

export type CliHarnessTool = {
	tool: ToolDefinition;
	dispose(): Promise<void>;
}

export async function runCliCommand(options: {
	command: string;
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
	stdin?: string;
}): Promise<CliCommandResult> {
	return await new Promise((resolve, reject) => {
		const child = spawn(options.command, options.args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, CLI_TIMEOUT_MS);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on("close", (exitCode) => {
			clearTimeout(timeout);
			resolve({
				command: options.command,
				args: options.args,
				stdout,
				stderr,
				exitCode,
				timedOut,
			});
		});
		if (options.stdin === undefined) {
			child.stdin.end();
		} else {
			child.stdin.end(options.stdin);
		}
	});
}

export function cliResultText(result: CliCommandResult): string {
	return JSON.stringify(
		{
			exitCode: result.exitCode,
			timedOut: result.timedOut,
			stdout: result.stdout,
			stderr: result.stderr,
		},
		null,
		2,
	);
}

export async function runCliHarness(options: {
	task: string;
	workspace: string;
	systemPrompt: string;
	createTool: (options: {
		cdpEndpoint: string;
		sessionName: string;
		workspace: string;
	}) => CliHarnessTool;
}): Promise<SessionRun> {
	const provider = new KernelBrowserProvider({
		headless: false,
		stealth: true,
		timeoutSeconds: Math.ceil(DEFAULT_TIMEOUT_MS / 1000),
	});
	const providerSession = await provider.createSession();
	const sessionName = `benchmark-${randomBytes(6).toString("hex")}`;
	const cliTool = options.createTool({
		cdpEndpoint: providerSession.cdpEndpoint,
		sessionName,
		workspace: options.workspace,
	});
	const session = await createPiSession({
		workspace: options.workspace,
		systemPrompt: options.systemPrompt,
		customTools: [cliTool.tool],
	});

	let run: SessionRun;
	try {
		run = await runPrompt(session, options.task);
	} catch (error) {
		try {
			await disposeCliHarness(cliTool, provider, providerSession.sessionId);
		} catch (cleanupError) {
			const message =
				cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
			process.stderr.write(`CLI browser cleanup also failed: ${message}\n`);
		}
		throw error;
	}
	try {
		await disposeCliHarness(cliTool, provider, providerSession.sessionId);
	} catch (error) {
		throw new SessionRunError(
			new Error(
				`CLI browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
			),
			run,
		);
	}
	return run;
}

async function disposeCliHarness(
	cliTool: CliHarnessTool,
	provider: KernelBrowserProvider,
	providerSessionId: string,
): Promise<void> {
	let toolError: unknown;
	try {
		await cliTool.dispose();
	} catch (error) {
		toolError = error;
	}
	let providerError: unknown;
	try {
		await provider.closeSession(providerSessionId);
	} catch (error) {
		providerError = error;
	}
	if (toolError || providerError) {
		throw new Error(
			[
				toolError
					? `tool cleanup: ${toolError instanceof Error ? toolError.message : String(toolError)}`
					: null,
				providerError
					? `provider cleanup: ${providerError instanceof Error ? providerError.message : String(providerError)}`
					: null,
			]
				.filter(Boolean)
				.join("; "),
		);
	}
}
