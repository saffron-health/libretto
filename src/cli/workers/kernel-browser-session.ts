import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createKernelBrowserSession } from "../core/kernel-browser-session.js";

type KernelBrowserSessionPayload = {
	session: string;
	url: string;
	headless: boolean;
	logFilePath: string;
	networkLogPath: string;
	actionsLogPath: string;
};

function appendJsonl(path: string, entry: unknown): void {
	appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

function childLogger(payload: KernelBrowserSessionPayload) {
	return (level: "info" | "warn" | "error", event: string, data: unknown = {}) => {
		appendJsonl(payload.logFilePath, {
			timestamp: new Date().toISOString(),
			id: Math.random().toString(36).slice(2, 10),
			level,
			scope: "libretto-cli.child",
			event,
			data,
		});
	};
}

async function main(): Promise<void> {
	const rawPayload = process.argv[2];
	if (!rawPayload) {
		throw new Error("Missing kernel browser session payload.");
	}

	const payload = JSON.parse(rawPayload) as KernelBrowserSessionPayload;
	mkdirSync(dirname(payload.networkLogPath), { recursive: true });
	const logChild = childLogger(payload);

	let browserSession:
		| Awaited<ReturnType<typeof createKernelBrowserSession>>
		| null = null;
	let shuttingDown = false;
	let pendingShutdown:
		| {
				event: string;
				exitCode: number;
				error?: unknown;
		  }
		| null = null;

	const completeShutdown = async (): Promise<void> => {
		if (!pendingShutdown) {
			return;
		}

		const { event, exitCode, error } = pendingShutdown;
		pendingShutdown = null;

		if (error) {
			logChild("error", event, {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
		} else {
			logChild("info", event, {
				pid: process.pid,
				session: payload.session,
				sessionId: browserSession?.sessionId,
			});
		}

		if (browserSession) {
			try {
				await browserSession.cleanup();
			} catch (cleanupError) {
				logChild("error", "kernel-child-cleanup-error", {
					message:
						cleanupError instanceof Error
							? cleanupError.message
							: String(cleanupError),
					stack:
						cleanupError instanceof Error ? cleanupError.stack : undefined,
				});
				process.exit(1);
				return;
			}
		}

		process.exit(exitCode);
	};

	const shutdown = async (
		event: string,
		exitCode: number,
		error?: unknown,
	): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		pendingShutdown = { event, exitCode, error };
		if (browserSession) {
			await completeShutdown();
		}
	};

	process.on("SIGTERM", () => {
		void shutdown("kernel-child-sigterm", 0);
	});
	process.on("SIGINT", () => {
		void shutdown("kernel-child-sigint", 0);
	});
	process.on("uncaughtException", (error) => {
		void shutdown("kernel-child-uncaught-exception", 1, error);
	});
	process.on("unhandledRejection", (reason) => {
		void shutdown("kernel-child-unhandled-rejection", 1, reason);
	});

	try {
		browserSession = await createKernelBrowserSession({
			session: payload.session,
			url: payload.url,
			headless: payload.headless,
			logAction: (entry) => appendJsonl(payload.actionsLogPath, entry),
			logNetwork: (entry) => appendJsonl(payload.networkLogPath, entry),
		});
	} catch (error) {
		const pendingExitCode = (
			pendingShutdown as { exitCode: number } | null
		)?.exitCode;
		if (pendingExitCode !== undefined) {
			logChild("warn", "kernel-child-startup-aborted", {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
			process.exit(pendingExitCode);
			return;
		}
		throw error;
	}

	if (pendingShutdown) {
		await completeShutdown();
		return;
	}

	logChild("info", "kernel-child-launched", {
		pid: process.pid,
		session: payload.session,
		sessionId: browserSession.sessionId,
		cdpWsUrl: browserSession.cdpWsUrl,
	});

	await new Promise(() => {});
}

void main().catch((error: unknown) => {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exit(1);
});
