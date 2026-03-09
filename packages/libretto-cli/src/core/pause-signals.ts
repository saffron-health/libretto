import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { getSessionDir } from "./context.js";

export type PauseSignalPaths = {
  pausedSignalPath: string;
  resumeSignalPath: string;
  completedSignalPath: string;
  failedSignalPath: string;
  outputSignalPath: string;
};

export function getPauseSignalPaths(session: string): PauseSignalPaths {
  const sessionDir = getSessionDir(session);
  return {
    pausedSignalPath: join(sessionDir, `${session}.paused`),
    resumeSignalPath: join(sessionDir, `${session}.resume`),
    completedSignalPath: join(sessionDir, `${session}.completed`),
    failedSignalPath: join(sessionDir, `${session}.failed`),
    outputSignalPath: join(sessionDir, `${session}.output`),
  };
}

export async function removeSignalIfExists(path: string): Promise<void> {
  if (!existsSync(path)) return;
  try {
    await unlink(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}
