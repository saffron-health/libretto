import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { LoggerApi } from "../../shared/logger/index.js";
import {
  getSessionDir,
  getSessionLogsPath,
  getSessionStatePath,
  LIBRETTO_SESSIONS_DIR,
} from "./context.js";
import {
  SessionAccessModeSchema,
  SESSION_STATE_VERSION,
  parseSessionStateContent,
  serializeSessionState,
  type SessionAccessMode,
  type SessionStatus,
  type SessionState,
} from "../../shared/state/index.js";

const SESSION_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export const SESSION_DEV_SERVER = "dev-server";
export const SESSION_BROWSER_AGENT = "browser-agent";

export function generateSessionName(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `ses-${id}`;
}
export { SESSION_STATE_VERSION };
export type { SessionAccessMode, SessionStatus, SessionState };

export function resolveSessionAccessMode(
  state: Pick<SessionState, "mode"> | null | undefined,
): SessionAccessMode {
  return SessionAccessModeSchema.parse(state?.mode);
}

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

export function listSessionsWithStateFile(): string[] {
  if (!existsSync(LIBRETTO_SESSIONS_DIR)) return [];
  return readdirSync(LIBRETTO_SESSIONS_DIR)
    .filter((session) => {
      try {
        validateSessionName(session);
      } catch {
        return false;
      }
      return existsSync(getSessionStatePath(session));
    })
    .sort();
}

function listActiveSessions(): string[] {
  return listSessionsWithStateFile();
}

/**
 * List sessions whose state file exists and whose pid is still running.
 * Returns session states (not just names) so callers can access port, status, etc.
 */
export function listRunningSessions(): SessionState[] {
  const sessions = listSessionsWithStateFile();
  const running: SessionState[] = [];
  for (const name of sessions) {
    const state = readSessionState(name);
    if (!state) continue;
    if (state.pid == null || !isPidRunning(state.pid)) continue;
    running.push(state);
  }
  return running;
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
  lines.push(`  libretto open <url> --session ${session}`);
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
    return parseSessionStateContent(
      readFileSync(stateFile, "utf-8"),
      stateFile,
    );
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
    mode: state.mode,
    port: state.port,
    pid: state.pid,
  });
}

export function setSessionMode(
  session: string,
  mode: SessionAccessMode,
  logger?: LoggerApi,
): SessionState {
  const state = readSessionStateOrThrow(session);
  const normalizedMode = SessionAccessModeSchema.parse(mode);
  if (state.mode === normalizedMode) {
    return state;
  }

  const nextState = {
    ...state,
    mode: normalizedMode,
  };
  writeSessionState(nextState, logger);
  return nextState;
}

export function assertSessionAllowsCommand(
  state: SessionState,
  commandName: string,
  allowedModes: readonly SessionAccessMode[],
): void {
  const mode = resolveSessionAccessMode(state);
  if (allowedModes.includes(mode)) {
    return;
  }

  const supportedModes = [...allowedModes].join(", ");
  throw new Error(
    `Command "${commandName}" is blocked for session "${state.session}" because it is in ${mode} mode. Allowed modes for this command: ${supportedModes}. Run \`libretto session-mode write-access --session ${state.session}\` to unlock the session.`,
  );
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

export function isPidRunning(pid: number): boolean {
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
  writeSessionState(
    {
      ...state,
      status,
    },
    logger,
  );
}

export function assertSessionAvailableForStart(
  session: string,
  logger?: LoggerApi,
): void {
  const existingState = readSessionState(session, logger);
  if (!existingState) return;
  if (existingState.pid == null || !isPidRunning(existingState.pid)) {
    setSessionStatus(session, "exited", logger);
    return;
  }
  const endpoint = `http://127.0.0.1:${existingState.port}`;
  throw new Error(
    `Session "${session}" is already open and connected to ${endpoint} (pid ${existingState.pid}). Create a new session or close the current one with: libretto close --session ${session}`,
  );
}
