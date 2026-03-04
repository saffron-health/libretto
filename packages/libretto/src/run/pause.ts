import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LaunchConfig, PausePayload } from "./types.js";
import { resolveSignalDir } from "./paths.js";
import { tmuxSessionExists } from "./process.js";

function pausedFilePath(session: string, config?: Pick<LaunchConfig, "io" | "repoRoot">): string {
  return join(resolveSignalDir(config), `${session}.paused`);
}

function resumeFilePath(session: string, config?: Pick<LaunchConfig, "io" | "repoRoot">): string {
  return join(resolveSignalDir(config), `${session}.resume`);
}

export async function waitForPauseSignal(opts: {
  session: string;
  config?: Pick<LaunchConfig, "io" | "repoRoot">;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{ pausedAt?: string; url?: string; pid?: number }> {
  const timeout = opts.timeoutMs ?? 900_000;
  const poll = opts.pollIntervalMs ?? 500;
  const pausedFile = pausedFilePath(opts.session, opts.config);
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (existsSync(pausedFile)) {
      try {
        const content = readFileSync(pausedFile, "utf-8");
        const info: PausePayload = JSON.parse(content);

        if (info.pid) {
          try {
            process.kill(info.pid, 0);
            return { pausedAt: info.pausedAt, url: info.url, pid: info.pid };
          } catch {
            try { unlinkSync(pausedFile); } catch {}
          }
        } else {
          return { pausedAt: info.pausedAt, url: info.url };
        }
      } catch { /* malformed file, keep polling */ }
    }

    if (!tmuxSessionExists(opts.session)) {
      const err = new Error("Job exited before hitting a pause.");
      (err as any).code = "JOB_EXITED_BEFORE_PAUSE";
      throw err;
    }

    await new Promise((r) => setTimeout(r, poll));
  }

  const err = new Error(`Timed out after ${timeout}ms waiting for pause.`);
  (err as any).code = "JOB_PAUSE_TIMEOUT";
  throw err;
}

export function writeResumeSignal(session: string, config?: Pick<LaunchConfig, "io" | "repoRoot">): boolean {
  const dir = resolveSignalDir(config);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resumeFilePath(session, config), JSON.stringify({ resumedAt: new Date().toISOString() }));
  return true;
}

export async function debugPause(
  page: { url(): string },
  session: string,
  config?: Pick<LaunchConfig, "io" | "repoRoot">,
): Promise<void> {
  const dir = resolveSignalDir(config);
  mkdirSync(dir, { recursive: true });

  const pausedFile = pausedFilePath(session, config);
  const resumeFile = resumeFilePath(session, config);

  // Clean stale files
  for (const f of [pausedFile, resumeFile]) {
    if (existsSync(f)) try { unlinkSync(f); } catch {}
  }

  const payload: PausePayload = {
    session,
    pausedAt: new Date().toISOString(),
    pid: process.pid,
    url: page.url(),
  };
  writeFileSync(pausedFile, JSON.stringify(payload));

  try {
    while (!existsSync(resumeFile)) {
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    for (const f of [pausedFile, resumeFile]) {
      if (existsSync(f)) try { unlinkSync(f); } catch {}
    }
  }
}
