import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveLibrettoRepoRoot } from "./repo-root.js";

const LIBRETTO_DIRNAME = ".libretto";
const LIBRETTO_SESSIONS_DIRNAME = "sessions";
const SESSION_STATE_FILENAME = "state.json";

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

export function ensureLibrettoSessionStatePath(
  sessionName: string,
  cwd: string = process.cwd(),
): string {
  const filePath = getLibrettoSessionStatePath(sessionName, cwd);
  mkdirSync(dirname(filePath), { recursive: true });
  return filePath;
}
