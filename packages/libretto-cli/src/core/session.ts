import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  getLog,
  getSessionDir,
  getSessionLogsPath,
  getSessionStatePath,
  LIBRETTO_CONFIG_DIR,
  LIBRETTO_CONFIG_PATH,
  LIBRETTO_SESSIONS_DIR,
} from "./context";
import {
  SESSION_STATE_VERSION,
  SessionModeSchema,
  parseSessionStateContent,
  serializeSessionState,
  type SessionMode,
  type SessionState,
} from "libretto/state";

const SESSION_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export const SESSION_DEFAULT = "default";
export const SESSION_DEV_SERVER = "dev-server";
export const SESSION_BROWSER_AGENT = "browser-agent";
export { SESSION_STATE_VERSION };
export type { SessionMode, SessionState };

type SessionPermissions = {
  sessions: Record<string, SessionMode>;
};

export function generateRunId(): string {
  return new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..+/, "")
    .replace(/^(\d{8})(\d{6})$/, "$1-$2");
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

export function readSessionState(session: string): SessionState | null {
  const log = getLog();
  const stateFile = getStateFilePath(session);
  if (!existsSync(stateFile)) {
    log.info("session-state-not-found", { session, stateFile });
    return null;
  }

  try {
    const content = readFileSync(stateFile, "utf-8");
    const state = parseSessionStateContent(content, stateFile);
    log.info("session-state-read", {
      session,
      port: state.port,
      pid: state.pid,
    });
    return state;
  } catch (err) {
    log.warn("session-state-parse-error", {
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

export function writeSessionState(state: SessionState): void {
  const log = getLog();
  const stateFile = getStateFilePath(state.session);
  const fileState = serializeSessionState(state);
  writeFileSync(stateFile, JSON.stringify(fileState, null, 2), "utf-8");
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
  mkdirSync(LIBRETTO_CONFIG_DIR, { recursive: true });
}

function isSessionMode(value: unknown): value is SessionMode {
  return SessionModeSchema.safeParse(value).success;
}

export function readSessionPermissions(): SessionPermissions {
  if (!existsSync(LIBRETTO_CONFIG_PATH)) {
    return { sessions: {} };
  }

  try {
    const rawConfig = JSON.parse(
      readFileSync(LIBRETTO_CONFIG_PATH, "utf-8"),
    ) as Record<string, unknown>;

    if (rawConfig.version !== 1) {
      throw new Error("unsupported version");
    }

    const rawPermissions = rawConfig.permissions;
    if (rawPermissions === undefined) {
      return { sessions: {} };
    }
    if (
      typeof rawPermissions !== "object" ||
      rawPermissions === null ||
      Array.isArray(rawPermissions)
    ) {
      throw new Error("permissions must be an object");
    }

    const typedPermissions = rawPermissions as Record<string, unknown>;
    if (
      typeof typedPermissions.sessions !== "object" ||
      typedPermissions.sessions === null ||
      Array.isArray(typedPermissions.sessions)
    ) {
      throw new Error("sessions must be an object");
    }

    const sessions = typedPermissions.sessions as Record<string, unknown>;
    const normalized: Record<string, SessionMode> = {};
    for (const [session, mode] of Object.entries(sessions)) {
      if (!isSessionMode(mode)) {
        throw new Error(`invalid mode for session "${session}"`);
      }
      normalized[session] = mode;
    }

    return { sessions: normalized };
  } catch {
    throw new Error(
      `Session permissions are invalid at ${LIBRETTO_CONFIG_PATH}.`,
    );
  }
}

export function writeSessionPermissions(permissions: SessionPermissions): void {
  ensureLibrettoDir();
  let rawConfig: Record<string, unknown> = { version: 1 };

  if (existsSync(LIBRETTO_CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(
        readFileSync(LIBRETTO_CONFIG_PATH, "utf-8"),
      ) as Record<string, unknown>;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("config must be an object");
      }
      rawConfig = parsed;
    } catch {
      throw new Error(
        `Session permissions are invalid at ${LIBRETTO_CONFIG_PATH}.`,
      );
    }
  }

  if (rawConfig.version !== undefined && rawConfig.version !== 1) {
    throw new Error(
      `Session permissions are invalid at ${LIBRETTO_CONFIG_PATH}.`,
    );
  }

  rawConfig.version = 1;
  rawConfig.permissions = permissions;
  writeFileSync(
    LIBRETTO_CONFIG_PATH,
    JSON.stringify(rawConfig, null, 2),
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
