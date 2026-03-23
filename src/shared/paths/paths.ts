import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveLibrettoRepoRoot } from "./repo-root.js";

const LIBRETTO_DIRNAME = ".libretto";
const LIBRETTO_SESSIONS_DIRNAME = "sessions";
const SESSION_STATE_FILENAME = "state.json";
const RUNNER_LOG_DIRNAME = "logs";
const RUNNER_LOG_FILENAME = "logs.jsonl";
const PAUSED_SIGNAL_SUFFIX = "paused";
const RESUME_SIGNAL_SUFFIX = "resume";

function getLibrettoRoot(cwd: string = process.cwd()): string {
  return join(resolveLibrettoRepoRoot(cwd), LIBRETTO_DIRNAME);
}

function getLibrettoSessionsDir(cwd: string = process.cwd()): string {
  return join(getLibrettoRoot(cwd), LIBRETTO_SESSIONS_DIRNAME);
}

function getLibrettoSessionDir(
  sessionName: string,
  cwd: string = process.cwd(),
): string {
  return join(getLibrettoSessionsDir(cwd), sessionName);
}

function getLibrettoSessionStatePath(
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

function getLibrettoRunnerLogDir(
  sessionName: string,
  cwd: string = process.cwd(),
): string {
  return join(getLibrettoSessionDir(sessionName, cwd), RUNNER_LOG_DIRNAME);
}

export function getRunnerLogPathForDir(logDir: string): string {
  return join(logDir, RUNNER_LOG_FILENAME);
}

export function getPauseSignalPathForDir(
  signalDir: string,
  sessionName: string,
  signal: "paused" | "resume",
): string {
  const suffix =
    signal === "paused" ? PAUSED_SIGNAL_SUFFIX : RESUME_SIGNAL_SUFFIX;
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
