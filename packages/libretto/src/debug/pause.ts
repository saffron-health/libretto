import type { Page } from "playwright";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isDebugMode } from "../config/config.js";

export type DebugPauseOptions = {
	/** Whether pause mode is enabled for this call. Defaults to env-based debug mode. */
	enabled?: boolean;
	/** Directory for pause signal files. Defaults to `tmp/libretto` in cwd. */
	signalDir?: string;
	/** Session name for the signal file. Defaults to "libretto". */
	sessionName?: string;
};

function getSignalDir(options?: DebugPauseOptions): string {
	return options?.signalDir ?? join(process.cwd(), "tmp", "libretto");
}

function getSessionName(options?: DebugPauseOptions): string {
	return options?.sessionName ?? "libretto";
}

function getPausedFilePath(options?: DebugPauseOptions): string {
	return join(getSignalDir(options), `${getSessionName(options)}.paused`);
}

function getResumeFilePath(options?: DebugPauseOptions): string {
	return join(getSignalDir(options), `${getSessionName(options)}.resume`);
}

function cleanupPauseFiles(options?: DebugPauseOptions): void {
	try {
		const pausedFile = getPausedFilePath(options);
		if (existsSync(pausedFile)) unlinkSync(pausedFile);
	} catch {}
	try {
		const resumeFile = getResumeFilePath(options);
		if (existsSync(resumeFile)) unlinkSync(resumeFile);
	} catch {}
}

/**
 * Pauses execution and signals external tools that the agent is paused and
 * ready for inspection.
 *
 * Works in both headless and headed mode, unlike page.pause() which is a
 * no-op in headless mode.
 *
 * Writes a signal file so that external tooling can detect the pause.
 * Blocks until a resume file appears.
 */
export async function debugPause(
	page: Page,
	options?: DebugPauseOptions,
): Promise<void> {
	const enabled = options?.enabled ?? isDebugMode();
	if (!enabled) return;

	const pausedFile = getPausedFilePath(options);
	const resumeFile = getResumeFilePath(options);

	mkdirSync(getSignalDir(options), { recursive: true });
	cleanupPauseFiles(options);

	const url = page.url();
	const signal = JSON.stringify({
		session: getSessionName(options),
		pausedAt: new Date().toISOString(),
		pid: process.pid,
		url,
	});
	writeFileSync(pausedFile, signal);

	console.log(`[debugPause] Paused at ${url}`);
	console.log(
		`[debugPause] Waiting for resume signal... (create ${resumeFile})`,
	);

	try {
		while (!existsSync(resumeFile)) {
			await new Promise((r) => setTimeout(r, 500));
		}
	} finally {
		cleanupPauseFiles(options);
	}

	console.log("[debugPause] Resumed");
}
