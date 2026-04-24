import { Logger, createFileLogSink } from "../../shared/logger/index.js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveLibrettoRepoRoot } from "../../shared/paths/repo-root.js";
import { validateSessionName } from "./session.js";

export const REPO_ROOT = resolveLibrettoRepoRoot();
export const LIBRETTO_CONFIG_DIR = join(REPO_ROOT, ".libretto");
export const LIBRETTO_CONFIG_PATH = join(LIBRETTO_CONFIG_DIR, "config.json");
export const PROFILES_DIR = join(LIBRETTO_CONFIG_DIR, "profiles");
export const LIBRETTO_SESSIONS_DIR = join(LIBRETTO_CONFIG_DIR, "sessions");
export const LIBRETTO_GITIGNORE_PATH = join(LIBRETTO_CONFIG_DIR, ".gitignore");

const LIBRETTO_GITIGNORE_CONTENT = [
  "# Local libretto runtime state",
  "sessions/",
  "profiles/",
  "",
].join("\n");

export function getSessionDir(session: string): string {
  return join(LIBRETTO_SESSIONS_DIR, session);
}

export function getSessionStatePath(session: string): string {
  return join(getSessionDir(session), "state.json");
}

export function getSessionLogsPath(session: string): string {
  return join(getSessionDir(session), "logs.jsonl");
}

export function getSessionNetworkLogPath(session: string): string {
  return join(getSessionDir(session), "network.jsonl");
}

export function getSessionActionsLogPath(session: string): string {
  return join(getSessionDir(session), "actions.jsonl");
}

/**
 * Unix domain sockets are limited to ~104 bytes on macOS.  We keep the
 * socket inside `.libretto/sessions/<name>/exec.sock` when the path fits,
 * falling back to a hashed path in `$TMPDIR` only when it would exceed
 * the limit.
 */
const UNIX_SOCKET_PATH_MAX = 104;

export function getSessionExecSocketPath(session: string): string {
  const preferred = join(getSessionDir(session), "exec.sock");
  if (Buffer.byteLength(preferred) < UNIX_SOCKET_PATH_MAX) {
    return preferred;
  }
  const absDir = resolve(getSessionDir(session));
  const hash = createHash("sha256").update(absDir).digest("hex").slice(0, 12);
  return join(tmpdir(), `lb-exec-${hash}.sock`);
}

export function getSessionSnapshotsDir(session: string): string {
  return join(getSessionDir(session), "snapshots");
}

export function getSessionSnapshotRunDir(
  session: string,
  snapshotRunId: string,
): string {
  return join(getSessionSnapshotsDir(session), snapshotRunId);
}

export function ensureLibrettoSetup(): void {
  mkdirSync(LIBRETTO_CONFIG_DIR, { recursive: true });
  mkdirSync(LIBRETTO_SESSIONS_DIR, { recursive: true });
  mkdirSync(PROFILES_DIR, { recursive: true });

  if (!existsSync(LIBRETTO_GITIGNORE_PATH)) {
    writeFileSync(LIBRETTO_GITIGNORE_PATH, LIBRETTO_GITIGNORE_CONTENT, "utf-8");
  }
}

export function createLoggerForSession(session: string): Logger {
  validateSessionName(session);
  const sessionDir = getSessionDir(session);
  mkdirSync(sessionDir, { recursive: true });
  const logFilePath = getSessionLogsPath(session);
  return new Logger(
    ["libretto"],
    [createFileLogSink({ filePath: logFilePath })],
  );
}

export async function withSessionLogger<T>(
  session: string,
  run: (logger: Logger) => Promise<T>,
): Promise<T> {
  const logger = createLoggerForSession(session);
  try {
    return await run(logger);
  } finally {
    await logger.close();
  }
}
