import type { Page } from "playwright";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { isDebugMode } from "../config/config.js";
import {
	ensureLibrettoPauseSignalDir,
	getLibrettoPausedSignalPath,
	getLibrettoResumeSignalPath,
	getPauseSignalPathForDir,
} from "../runtime/paths.js";

export type DebugPauseOptions = {
	/** Directory for pause signal files. Defaults to `.libretto/sessions/<sessionName>` in cwd. */
	signalDir?: string;
	/** Session name for the signal file. Defaults to "libretto". */
	sessionName?: string;
};

function getSessionName(options?: DebugPauseOptions): string {
	return options?.sessionName ?? "libretto";
}

function getPausedFilePath(options?: DebugPauseOptions): string {
	const signalDir = options?.signalDir;
	const sessionName = getSessionName(options);
	if (signalDir) {
		return getPauseSignalPathForDir(signalDir, sessionName, "paused");
	}
	return getLibrettoPausedSignalPath(sessionName);
}

function getResumeFilePath(options?: DebugPauseOptions): string {
	const signalDir = options?.signalDir;
	const sessionName = getSessionName(options);
	if (signalDir) {
		return getPauseSignalPathForDir(signalDir, sessionName, "resume");
	}
	return getLibrettoResumeSignalPath(sessionName);
}

function cleanupPauseFiles(options?: DebugPauseOptions): void {
	const pausedFile = getPausedFilePath(options);
	const resumeFile = getResumeFilePath(options);
	if (existsSync(pausedFile)) rmSync(pausedFile, { force: true });
	if (existsSync(resumeFile)) rmSync(resumeFile, { force: true });
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
	if (!isDebugMode()) return;

	const pausedFile = getPausedFilePath(options);
	const resumeFile = getResumeFilePath(options);

	if (options?.signalDir) {
		mkdirSync(options.signalDir, { recursive: true });
	} else {
		ensureLibrettoPauseSignalDir(getSessionName(options));
	}
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
