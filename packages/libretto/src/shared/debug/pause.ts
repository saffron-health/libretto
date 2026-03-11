import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

/**
 * Module-level session name, set by the CLI runtime before invoking the workflow.
 * Standalone `pause()` reads this to locate signal files.
 */
let _sessionName: string | undefined;

/**
 * Called by the CLI runtime to make the session name available to `pause()`.
 */
export function setSessionForPause(session: string): void {
	_sessionName = session;
}

function getSessionFromProcessArgs(): string | undefined {
	const rawPayload = process.argv[2];
	if (!rawPayload) return undefined;
	try {
		const parsed = JSON.parse(rawPayload) as { session?: string };
		return typeof parsed.session === "string" ? parsed.session : undefined;
	} catch {
		return undefined;
	}
}

function resolveSession(): string | undefined {
	return _sessionName ?? getSessionFromProcessArgs();
}

/**
 * Standalone pause function.
 *
 * - In production (`NODE_ENV === "production"`), returns immediately (no-op).
 * - Otherwise, writes a `.paused` signal file and polls for a `.resume` signal,
 *   using the same file-based mechanism as the CLI runner.
 *
 * Import directly: `import { pause } from "libretto";`
 */
export async function pause(): Promise<void> {
	if (process.env.NODE_ENV === "production") {
		return;
	}

	const session = resolveSession();
	if (!session) {
		// No session context available — likely running outside the CLI runner.
		// Behave as a no-op to avoid crashing the workflow.
		return;
	}

	// Dynamically import pause-signals to avoid circular dependency issues.
	// These are CLI-internal modules available in the worker process.
	const { getPauseSignalPaths, removeSignalIfExists } = await import(
		"../../cli/core/pause-signals.js"
	);
	const { getSessionDir } = await import("../../cli/core/context.js");

	const signalPaths = getPauseSignalPaths(session);
	const { pausedSignalPath, resumeSignalPath } = signalPaths;

	await mkdir(getSessionDir(session), { recursive: true });
	await removeSignalIfExists(resumeSignalPath);

	const details = {
		sessionName: session,
		pausedAt: new Date().toISOString(),
		url: "unknown",
	};

	// Try to read the current page URL from the process (best-effort).
	// The standalone pause doesn't have access to the page object,
	// so we just record what we can.
	await writeFile(pausedSignalPath, JSON.stringify(details, null, 2), "utf8");

	console.log(`[pause] Paused (session: ${session})`);
	console.log("[pause] Waiting for resume signal...");

	const RESUME_POLL_INTERVAL_MS = 250;
	while (!existsSync(resumeSignalPath)) {
		await new Promise((resolve) =>
			setTimeout(resolve, RESUME_POLL_INTERVAL_MS),
		);
	}

	await removeSignalIfExists(resumeSignalPath);
	await removeSignalIfExists(pausedSignalPath);
	console.log("[pause] Resume signal received. Continuing workflow...");
}
