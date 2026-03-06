import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const LIBRETTO_DIRNAME = ".libretto";
export const LIBRETTO_SESSIONS_DIRNAME = "sessions";
const SESSION_STATE_FILENAME = "state.json";
const RUNNER_LOG_DIRNAME = "logs";
const RUNNER_LOG_FILENAME = "logs.jsonl";
const PAUSED_SIGNAL_SUFFIX = "paused";
const RESUME_SIGNAL_SUFFIX = "resume";

export function getLibrettoRoot(cwd: string = process.cwd()): string {
	return join(cwd, LIBRETTO_DIRNAME);
}

export function getLibrettoSessionsDir(cwd: string = process.cwd()): string {
	return join(getLibrettoRoot(cwd), LIBRETTO_SESSIONS_DIRNAME);
}

export function getLibrettoSessionDir(
	sessionName: string,
	cwd: string = process.cwd(),
): string {
	return join(getLibrettoSessionsDir(cwd), sessionName);
}

export function getLibrettoSessionStatePath(
	sessionName: string,
	cwd: string = process.cwd(),
): string {
	return join(getLibrettoSessionDir(sessionName, cwd), SESSION_STATE_FILENAME);
}

export function getLibrettoPauseSignalDir(
	sessionName: string,
	cwd: string = process.cwd(),
): string {
	return getLibrettoSessionDir(sessionName, cwd);
}

export function getLibrettoRunnerLogDir(
	sessionName: string,
	cwd: string = process.cwd(),
): string {
	return join(getLibrettoSessionDir(sessionName, cwd), RUNNER_LOG_DIRNAME);
}

export function getLibrettoRunnerLogPath(
	sessionName: string,
	cwd: string = process.cwd(),
): string {
	return join(getLibrettoRunnerLogDir(sessionName, cwd), RUNNER_LOG_FILENAME);
}

export function getRunnerLogPathForDir(logDir: string): string {
	return join(logDir, RUNNER_LOG_FILENAME);
}

export function getPauseSignalPathForDir(
	signalDir: string,
	sessionName: string,
	signal: "paused" | "resume",
): string {
	const suffix = signal === "paused" ? PAUSED_SIGNAL_SUFFIX : RESUME_SIGNAL_SUFFIX;
	return join(signalDir, `${sessionName}.${suffix}`);
}

export function getLibrettoPausedSignalPath(
	sessionName: string,
	cwd: string = process.cwd(),
): string {
	return getPauseSignalPathForDir(
		getLibrettoPauseSignalDir(sessionName, cwd),
		sessionName,
		"paused",
	);
}

export function getLibrettoResumeSignalPath(
	sessionName: string,
	cwd: string = process.cwd(),
): string {
	return getPauseSignalPathForDir(
		getLibrettoPauseSignalDir(sessionName, cwd),
		sessionName,
		"resume",
	);
}

export function ensureLibrettoSessionDir(
	sessionName: string,
	cwd: string = process.cwd(),
): string {
	const dir = getLibrettoSessionDir(sessionName, cwd);
	mkdirSync(dir, { recursive: true });
	return dir;
}

export function ensureLibrettoSessionStatePath(
	sessionName: string,
	cwd: string = process.cwd(),
): string {
	const filePath = getLibrettoSessionStatePath(sessionName, cwd);
	mkdirSync(dirname(filePath), { recursive: true });
	return filePath;
}

export function ensureLibrettoPauseSignalDir(
	sessionName: string,
	cwd: string = process.cwd(),
): string {
	const dir = getLibrettoPauseSignalDir(sessionName, cwd);
	mkdirSync(dir, { recursive: true });
	return dir;
}

export function ensureLibrettoRunnerLogDir(
	sessionName: string,
	cwd: string = process.cwd(),
): string {
	const dir = getLibrettoRunnerLogDir(sessionName, cwd);
	mkdirSync(dir, { recursive: true });
	return dir;
}

export function ensureLibrettoRunnerLogPath(
	sessionName: string,
	cwd: string = process.cwd(),
): string {
	const filePath = getLibrettoRunnerLogPath(sessionName, cwd);
	mkdirSync(dirname(filePath), { recursive: true });
	return filePath;
}
