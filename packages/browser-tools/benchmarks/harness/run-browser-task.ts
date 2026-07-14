import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { KernelBrowserProvider } from "@libretto/browser-tools/kernel";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import {
	browserTaskPrompt,
	createPiSession,
	DEFAULT_TIMEOUT_MS,
	runPrompt,
	SessionRunError,
	type SessionRun,
} from "../agent.js";

const MAX_KERNEL_JWT_RETRIES = 2;

export type BrowserConnection = {
	cdpEndpoint: string;
	sessionName: string;
};

export async function runBrowserTask(options: {
	task: string;
	workspace: string;
	customTools?: ToolDefinition[];
	skillPaths?: string[];
	buildAppendSystemPrompt?: (connection: BrowserConnection) => string;
}): Promise<SessionRun> {
	const sessionFile = join(options.workspace, "session.jsonl");
	const prompt = browserTaskPrompt({ task: options.task });

	if (!options.buildAppendSystemPrompt) {
		const session = await createPiSession({
			workspace: options.workspace,
			sessionFile,
			customTools: options.customTools,
			skillPaths: options.skillPaths,
		});
		return await runPrompt(session, prompt);
	}

	const provider = new KernelBrowserProvider({
		headless: false,
		stealth: true,
		timeoutSeconds: Math.ceil(DEFAULT_TIMEOUT_MS / 1000),
	});
	const buildAppendSystemPrompt = options.buildAppendSystemPrompt;

	for (let attempt = 0; attempt <= MAX_KERNEL_JWT_RETRIES; attempt += 1) {
		if (attempt > 0) {
			await unlink(sessionFile).catch(() => {});
		}
		let providerSession: Awaited<ReturnType<typeof provider.createSession>>;
		try {
			providerSession = await provider.createSession();
		} catch (error) {
			if (isKernelJwtError(error) && attempt < MAX_KERNEL_JWT_RETRIES) {
				logKernelJwtRetry(attempt + 1);
				continue;
			}
			throw error;
		}

		const appendSystemPrompt = [
			buildAppendSystemPrompt({
				cdpEndpoint: providerSession.cdpEndpoint,
				sessionName: `benchmark-${providerSession.sessionId}`,
			}),
		];
		let session: Awaited<ReturnType<typeof createPiSession>>;
		try {
			session = await createPiSession({
				workspace: options.workspace,
				sessionFile,
				appendSystemPrompt,
				skillPaths: options.skillPaths,
			});
		} catch (error) {
			await closeProviderAfterFailure(provider, providerSession.sessionId);
			throw error;
		}

		let attemptRun: SessionRun;
		try {
			attemptRun = await runPrompt(session, prompt);
		} catch (error) {
			await closeProviderAfterFailure(provider, providerSession.sessionId);
			session.dispose();
			if (!(error instanceof SessionRunError)) throw error;
			if (
				(isKernelJwtFailure(error.run) || isKernelJwtError(error)) &&
				attempt < MAX_KERNEL_JWT_RETRIES
			) {
				logKernelJwtRetry(attempt + 1);
				continue;
			}
			if (isKernelJwtFailure(error.run) || isKernelJwtError(error)) {
				throw new SessionRunError(
					new Error(
						`Kernel rejected the browser JWT after ${MAX_KERNEL_JWT_RETRIES + 1} attempts. Rerun this benchmark attempt to provision a fresh Kernel session.`,
					),
					error.run,
				);
			}
			throw error;
		}

		try {
			await provider.closeSession(providerSession.sessionId);
		} catch (error) {
			throw new SessionRunError(
				new Error(
					`Browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
				),
				attemptRun,
			);
		}
		if (!isKernelJwtFailure(attemptRun)) return attemptRun;
		if (attempt < MAX_KERNEL_JWT_RETRIES) {
			attemptRun.session.dispose();
			logKernelJwtRetry(attempt + 1);
			continue;
		}
		throw new SessionRunError(
			new Error(
				`Kernel rejected the browser JWT after ${MAX_KERNEL_JWT_RETRIES + 1} attempts. Rerun this benchmark attempt to provision a fresh Kernel session.`,
			),
			attemptRun,
		);
	}

	throw new Error(
		"Kernel JWT retry loop ended unexpectedly. Rerun the benchmark attempt.",
	);
}

function isKernelJwtFailure(run: SessionRun): boolean {
	for (const message of run.session.messages) {
		if (message.role !== "toolResult") continue;
		for (const content of message.content) {
			if (content.type === "text" && isKernelJwtText(content.text)) return true;
		}
	}
	return false;
}

function isKernelJwtError(error: unknown): boolean {
	return isKernelJwtText(error instanceof Error ? error.message : String(error));
}

function isKernelJwtText(text: string): boolean {
	return (
		/\binvalid jwt\b/i.test(text) ||
		/\bunexpected server response:\s*401\b/i.test(text) ||
		/\bwebsocket\b[^\n]{0,200}\b401\b/i.test(text) ||
		/\b401\b[^\n]{0,200}\bwebsocket\b/i.test(text)
	);
}

function logKernelJwtRetry(retry: number): void {
	process.stdout.write(
		`  -> Kernel rejected the browser JWT; provisioning a fresh session (retry ${retry}/${MAX_KERNEL_JWT_RETRIES}).\n`,
	);
}

async function closeProviderAfterFailure(
	provider: KernelBrowserProvider,
	sessionId: string,
): Promise<void> {
	try {
		await provider.closeSession(sessionId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`Browser cleanup also failed: ${message}\n`);
	}
}

export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
