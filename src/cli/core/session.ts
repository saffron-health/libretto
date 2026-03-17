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
  SESSION_STATE_VERSION,
  parseSessionStateContent,
  serializeSessionState,
  type SessionStatus,
  type SessionState,
} from "../../shared/state/index.js";

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

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type SessionHealthStatus =
  | "missing"
  | "healthy"
  | "stale-no-process"
  | "stale-no-browser"
  | "stale-no-pages";

function isOperationalTarget(target: { type?: string; url?: string }): boolean {
  return (
    target.type === "page" &&
    typeof target.url === "string" &&
    !target.url.startsWith("devtools://") &&
    !target.url.startsWith("chrome-error://")
  );
}

export async function probeSessionHealth(
  session: string,
  logger?: LoggerApi,
): Promise<{ status: SessionHealthStatus; state: SessionState | null }> {
  const state = readSessionState(session, logger);
  if (!state) return { status: "missing", state: null };

  if (!isPidRunning(state.pid)) {
    return { status: "stale-no-process", state };
  }

  try {
    const versionRes = await fetch(
      `http://127.0.0.1:${state.port}/json/version`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!versionRes.ok) {
      return { status: "stale-no-browser", state };
    }
  } catch {
    return { status: "stale-no-browser", state };
  }

  try {
    const listRes = await fetch(
      `http://127.0.0.1:${state.port}/json/list`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!listRes.ok) {
      return { status: "stale-no-pages", state };
    }
    const targets = (await listRes.json()) as Array<{
      type?: string;
      url?: string;
    }>;
    const hasOperational = targets.some(isOperationalTarget);
    return {
      status: hasOperational ? "healthy" : "stale-no-pages",
      state,
    };
  } catch {
    return { status: "stale-no-pages", state };
  }
}

export async function reclaimStaleSession(
  session: string,
  logger?: LoggerApi,
): Promise<void> {
  const state = readSessionState(session, logger);
  if (!state) return;

  logger?.info("session-reclaim-start", {
    session,
    pid: state.pid,
    port: state.port,
  });

  if (isPidRunning(state.pid)) {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {}
    const deadline = Date.now() + 2000;
    while (isPidRunning(state.pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isPidRunning(state.pid)) {
      try {
        process.kill(state.pid, "SIGKILL");
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  clearSessionState(session, logger);
  logger?.info("session-reclaim-complete", { session });
}

export async function ensureSessionAvailableForStart(
  session: string,
  logger?: LoggerApi,
): Promise<void> {
  const { status, state } = await probeSessionHealth(session, logger);

  if (status === "missing") return;

  if (status === "stale-no-process") {
    logger?.info("session-reclaim-dead-process", {
      session,
      pid: state!.pid,
    });
    clearSessionState(session, logger);
    return;
  }

  if (status === "stale-no-browser" || status === "stale-no-pages") {
    logger?.info("session-reclaim-stale", {
      session,
      status,
      pid: state!.pid,
    });
    console.log(
      `Reclaiming stale session "${session}" (${status === "stale-no-browser" ? "browser unreachable" : "no open pages"}).`,
    );
    await reclaimStaleSession(session, logger);
    return;
  }

  const endpoint = `http://127.0.0.1:${state!.port}`;
  throw new Error(
    `Session "${session}" is already open and connected to ${endpoint} (pid ${state!.pid}). Create a new session or close the current one with: libretto close --session ${session}`,
  );
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
  if (!isPidRunning(existingState.pid)) {
    setSessionStatus(session, "exited", logger);
    return;
  }
  const endpoint = `http://127.0.0.1:${existingState.port}`;
  throw new Error(
    `Session "${session}" is already open and connected to ${endpoint} (pid ${existingState.pid}). Create a new session or close the current one with: libretto close --session ${session}`,
  );
}
