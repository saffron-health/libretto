import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { getSessionDir } from "../../cli/core/context.js";
import { getPauseSignalPaths, removeSignalIfExists } from "../../cli/core/pause-signals.js";
import { listSessionsWithStateFile, readSessionState } from "../../cli/core/session.js";

function isPidRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function getRunningSessions(): string[] {
	return listSessionsWithStateFile().filter((candidate) => {
		const state = readSessionState(candidate);
		return state !== null && isPidRunning(state.pid);
	});
}

function throwMissingSessionError(): never {
	const runningSessions = getRunningSessions();
	const lines = ["pause(session) requires a non-empty session ID."];

	if (runningSessions.length > 0) {
		lines.push("", "Running sessions:");
		for (const runningSession of runningSessions) {
			lines.push(`  ${runningSession}`);
		}
	}

	throw new Error(lines.join("\n"));
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
export async function pause(session: string): Promise<void> {
	if (process.env.NODE_ENV === "production") {
		return;
	}

	if (typeof session !== "string" || session.trim().length === 0) {
		throwMissingSessionError();
	}

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
