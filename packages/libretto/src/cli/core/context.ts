import { Logger, createFileLogSink } from "../../shared/logger/index.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
