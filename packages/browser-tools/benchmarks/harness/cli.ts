import { KernelBrowserProvider } from "../../src/providers/kernel.js";
import {
	createPiSession,
	DEFAULT_TIMEOUT_MS,
	runPrompt,
	SessionRunError,
	type SessionRun,
} from "../agent.js";

export async function runBashHarness(options: {
	task: string;
	workspace: string;
	buildSystemPrompt: (connection: {
		cdpEndpoint: string;
		sessionName: string;
	}) => string;
}): Promise<SessionRun> {
	const provider = new KernelBrowserProvider({
		headless: false,
		stealth: true,
		timeoutSeconds: Math.ceil(DEFAULT_TIMEOUT_MS / 1000),
	});
	const provisioningStartedMs = Date.now();
	const providerSession = await provider.createSession();
	const provisioningDurationMs = Date.now() - provisioningStartedMs;
	const sessionName = `benchmark-${providerSession.sessionId}`;
	let session: Awaited<ReturnType<typeof createPiSession>>;
	try {
		session = await createPiSession({
			workspace: options.workspace,
			systemPrompt: options.buildSystemPrompt({
				cdpEndpoint: providerSession.cdpEndpoint,
				sessionName,
			}),
			tools: ["bash"],
		});
	} catch (error) {
		await closeProviderAfterFailure(provider, providerSession.sessionId);
		throw error;
	}

	let run: SessionRun;
	try {
		run = await runPrompt(session, options.task);
	} catch (error) {
		if (error instanceof SessionRunError) {
			error.run.durationMs += provisioningDurationMs;
		}
		await closeProviderAfterFailure(provider, providerSession.sessionId);
		throw error;
	}
	run.durationMs += provisioningDurationMs;
	try {
		await provider.closeSession(providerSession.sessionId);
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

async function closeProviderAfterFailure(
	provider: KernelBrowserProvider,
	sessionId: string,
): Promise<void> {
	try {
		await provider.closeSession(sessionId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`CLI browser cleanup also failed: ${message}\n`);
	}
}

export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
