import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getLog, LIBRETTO_DIR, STATE_DIR } from "./context";

const SESSION_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const SESSION_PERMISSIONS_PATH = join(LIBRETTO_DIR, "session-permissions.json");

export const SESSION_DEFAULT = "default";
export const SESSION_DEV_SERVER = "dev-server";
export const SESSION_BROWSER_AGENT = "browser-agent";
export type SessionMode = "read-only" | "interactive";

export type SessionState = {
  port: number;
  pid: number;
  session: string;
  runId: string;
  startedAt: string;
  mode?: SessionMode;
};

type SessionPermissions = {
  version: 1;
  sessions: Record<string, SessionMode>;
};

export function generateRunId(): string {
  return new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..+/, "")
    .replace(/^(\d{8})(\d{6})$/, "$1-$2");
}

export function getRunDir(runId: string): string {
  return join(STATE_DIR, runId);
}

export function logFileForRun(runId: string): string {
  const dir = getRunDir(runId);
  mkdirSync(dir, { recursive: true });
  return join(dir, "session.log");
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
  mkdirSync(STATE_DIR, { recursive: true });
  return join(STATE_DIR, `${session}.json`);
}

export function readSessionState(session: string): SessionState | null {
  const log = getLog();
  const stateFile = getStateFilePath(session);
  if (!existsSync(stateFile)) {
    log.info("session-state-not-found", { session, stateFile });
    return null;
  }

  try {
    const content = readFileSync(stateFile, "utf-8");
    const state = JSON.parse(content) as SessionState;
    log.info("session-state-read", {
      session,
      port: state.port,
      pid: state.pid,
    });
    return state;
  } catch (err) {
    log.warn("session-state-parse-error", { error: err, session, stateFile });
    return null;
  }
}

function listActiveSessions(): string[] {
  if (!existsSync(STATE_DIR)) return [];
  return readdirSync(STATE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function getSessionStateOrThrow(session: string): SessionState {
  const stateFile = getStateFilePath(session);
  if (!existsSync(stateFile)) {
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
    lines.push(`Start one with:`);
    lines.push(`  libretto-cli open <url> --session ${session}`);
    throw new Error(lines.join("\n"));
  }

  try {
    return JSON.parse(readFileSync(stateFile, "utf-8")) as SessionState;
  } catch (err) {
    throw new Error(
      `Could not read session state for "${session}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function writeSessionState(state: SessionState): void {
  const log = getLog();
  const stateFile = getStateFilePath(state.session);
  writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
  log.info("session-state-write", {
    session: state.session,
    stateFile,
    port: state.port,
    pid: state.pid,
    runId: state.runId,
  });
}

export function clearSessionState(session: string): void {
  const log = getLog();
  const stateFile = getStateFilePath(session);
  if (!existsSync(stateFile)) {
    log.info("session-state-clear-missing", { session, stateFile });
    return;
  }
  unlinkSync(stateFile);
  log.info("session-state-cleared", { session, stateFile });
}

function ensureLibrettoDir(): void {
  mkdirSync(LIBRETTO_DIR, { recursive: true });
}

function isSessionMode(value: unknown): value is SessionMode {
  return value === "read-only" || value === "interactive";
}

export function readSessionPermissions(): SessionPermissions {
  if (!existsSync(SESSION_PERMISSIONS_PATH)) {
    return { version: 1, sessions: {} };
  }

  try {
    const raw = JSON.parse(
      readFileSync(SESSION_PERMISSIONS_PATH, "utf-8"),
    ) as Record<string, unknown>;

    if (raw.version !== 1) {
      throw new Error("unsupported version");
    }
    if (
      typeof raw.sessions !== "object" ||
      raw.sessions === null ||
      Array.isArray(raw.sessions)
    ) {
      throw new Error("sessions must be an object");
    }

    const sessions = raw.sessions as Record<string, unknown>;
    const normalized: Record<string, SessionMode> = {};
    for (const [session, mode] of Object.entries(sessions)) {
      if (!isSessionMode(mode)) {
        throw new Error(`invalid mode for session "${session}"`);
      }
      normalized[session] = mode;
    }

    return { version: 1, sessions: normalized };
  } catch {
    throw new Error(
      `Session permissions are invalid at ${SESSION_PERMISSIONS_PATH}.`,
    );
  }
}

export function writeSessionPermissions(permissions: SessionPermissions): void {
  ensureLibrettoDir();
  writeFileSync(
    SESSION_PERMISSIONS_PATH,
    JSON.stringify(permissions, null, 2),
    "utf-8",
  );
}

export function getSessionPermissionMode(session: string): SessionMode {
  const permissions = readSessionPermissions();
  return permissions.sessions[session] ?? "read-only";
}

export function setSessionPermissionMode(
  session: string,
  mode: SessionMode,
): void {
  const permissions = readSessionPermissions();
  if (mode === "read-only") {
    delete permissions.sessions[session];
  } else {
    permissions.sessions[session] = mode;
  }
  writeSessionPermissions(permissions);
}

export function resolveSessionMode(
  session: string,
  sessionState?: SessionState | null,
): SessionMode {
  return sessionState?.mode ?? getSessionPermissionMode(session);
}

export function readOnlySessionError(session: string): string {
  return (
    `Session "${session}" is read-only. ` +
    "Only a human can authorize interactive mode. " +
    `If you want me to enable it, explicitly tell me to run: libretto-cli session-mode interactive --session ${session}`
  );
}
