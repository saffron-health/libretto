import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { LoggerApi } from "libretto/logger";
import {
  getSessionDir,
  getSessionLogsPath,
  getSessionStatePath,
  LIBRETTO_SESSIONS_DIR,
} from "./context.js";
import {
  SESSION_STATE_VERSION,
  SessionStatusSchema,
  parseSessionStateContent,
  serializeSessionState,
  type SessionStatus,
  type SessionState,
} from "libretto/state";

const SESSION_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export const SESSION_DEFAULT = "default";
export const SESSION_DEV_SERVER = "dev-server";
export const SESSION_BROWSER_AGENT = "browser-agent";
export { SESSION_STATE_VERSION };
export type { SessionStatus, SessionState };

export function logFileForSession(session: string): string {
  validateSessionName(session);
  const dir = getSessionDir(session);
  mkdirSync(dir, { recursive: true });
  return getSessionLogsPath(session);
}

export function validateSessionName(session: string): void {
  if (
    !SESSION_NAME_PATTERN.test(session) ||
    session.includes("..") ||
    session.includes("/") ||
    session.includes("\\")
  ) {
    throw new Error(
      "Invalid session name. Use only letters, numbers, dots, underscores, and dashes.",
    );
  }
}

export function getStateFilePath(session: string): string {
  validateSessionName(session);
  const sessionDir = getSessionDir(session);
  mkdirSync(sessionDir, { recursive: true });
  return getSessionStatePath(session);
}

export function readSessionState(
  session: string,
  logger?: LoggerApi,
): SessionState | null {
  const stateFile = getStateFilePath(session);
  if (!existsSync(stateFile)) {
    logger?.info("session-state-not-found", { session, stateFile });
    return null;
  }

  try {
    const content = readFileSync(stateFile, "utf-8");
    const state = parseSessionStateContent(content, stateFile);
    logger?.info("session-state-read", {
      session,
      port: state.port,
      pid: state.pid,
    });
    return state;
  } catch (err) {
    logger?.warn("session-state-parse-error", {
      error: err instanceof Error ? err.message : String(err),
      session,
      stateFile,
    });
    return null;
  }
}

function listActiveSessions(): string[] {
  if (!existsSync(LIBRETTO_SESSIONS_DIR)) return [];
  return readdirSync(LIBRETTO_SESSIONS_DIR).filter((session) =>
    existsSync(getSessionStatePath(session)),
  );
}

function throwSessionNotFoundError(session: string): never {
  const active = listActiveSessions();
  const lines = [`No session "${session}" found.`];
  if (active.length > 0) {
    lines.push("");
    lines.push("Active sessions:");
    for (const name of active) {
      lines.push(`  ${name}`);
    }
  } else {
    lines.push("");
    lines.push("No active sessions.");
  }
  lines.push("");
  lines.push("Start one with:");
  lines.push(`  libretto-cli open <url> --session ${session}`);
  throw new Error(lines.join("\n"));
}

export function assertSessionStateExistsOrThrow(session: string): void {
  const stateFile = getStateFilePath(session);
  if (!existsSync(stateFile)) {
    throwSessionNotFoundError(session);
  }
}

export function readSessionStateOrThrow(session: string): SessionState {
  const stateFile = getStateFilePath(session);
  if (!existsSync(stateFile)) {
    throwSessionNotFoundError(session);
  }

  try {
    return parseSessionStateContent(readFileSync(stateFile, "utf-8"), stateFile);
  } catch (err) {
    throw new Error(
      `Could not read session state for "${session}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function writeSessionState(
  state: SessionState,
  logger?: LoggerApi,
): void {
  const stateFile = getStateFilePath(state.session);
  const fileState = serializeSessionState(state);
  writeFileSync(stateFile, JSON.stringify(fileState, null, 2), "utf-8");
  logger?.info("session-state-write", {
    session: state.session,
    stateFile,
    port: state.port,
    pid: state.pid,
  });
}

export function clearSessionState(session: string, logger?: LoggerApi): void {
  const stateFile = getStateFilePath(session);
  if (!existsSync(stateFile)) {
    logger?.info("session-state-clear-missing", { session, stateFile });
    return;
  }
  unlinkSync(stateFile);
  logger?.info("session-state-cleared", { session, stateFile });
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return SessionStatusSchema.safeParse(value).success;
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function setSessionStatus(
  session: string,
  status: SessionStatus,
  logger?: LoggerApi,
): void {
  const state = readSessionState(session, logger);
  if (!state) return;
  if (state.status === status) return;
  writeSessionState({
    ...state,
    status,
  }, logger);
}

export function assertSessionAvailableForStart(
  session: string,
  logger?: LoggerApi,
): void {
  const existingState = readSessionState(session, logger);
  if (!existingState) return;
  if (isSessionStatus(existingState.status)) {
    if (
      existingState.status === "completed" ||
      existingState.status === "failed" ||
      existingState.status === "exited"
    ) {
      return;
    }
  }
  if (!isPidRunning(existingState.pid)) {
    setSessionStatus(session, "exited", logger);
    return;
  }
  const endpoint = `http://127.0.0.1:${existingState.port}`;
  throw new Error(
    `Session "${session}" is already open and connected to ${endpoint} (pid ${existingState.pid}). Create a new session or close the current one with: libretto-cli close --session ${session}`,
  );
}
