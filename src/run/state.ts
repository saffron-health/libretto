import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SessionState, LaunchConfig } from "./types.js";
import { resolveStateDir } from "./paths.js";

function stateFilePath(session: string, config?: Pick<LaunchConfig, "io" | "repoRoot">): string {
  return resolve(resolveStateDir(config), `${session}.json`);
}

export function saveSessionState(state: SessionState, config?: Pick<LaunchConfig, "io" | "repoRoot">): void {
  const dir = resolveStateDir(config);
  mkdirSync(dir, { recursive: true });
  writeFileSync(stateFilePath(state.session, config), JSON.stringify(state, null, 2));
}

export function loadSessionState(session: string, config?: Pick<LaunchConfig, "io" | "repoRoot">): SessionState | null {
  const path = stateFilePath(session, config);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export function deleteSessionState(session: string, config?: Pick<LaunchConfig, "io" | "repoRoot">): void {
  const path = stateFilePath(session, config);
  if (existsSync(path)) {
    try { unlinkSync(path); } catch {}
  }
}
