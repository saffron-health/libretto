import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function isTmuxAvailable(): boolean {
  try {
    return spawnSync("tmux", ["-V"]).status === 0;
  } catch {
    return false;
  }
}

export function tmuxSessionExists(sessionName: string): boolean {
  try {
    return spawnSync("tmux", ["has-session", "-t", sessionName]).status === 0;
  } catch {
    return false;
  }
}

export function killTmuxSession(sessionName: string): boolean {
  if (!tmuxSessionExists(sessionName)) return false;
  return spawnSync("tmux", ["kill-session", "-t", sessionName]).status === 0;
}

export function ensureLogFile(logFile: string): void {
  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(logFile, "");
}

export function launchInTmux(opts: {
  sessionName: string;
  command: string[];
  env?: Record<string, string>;
}): { ok: true } | { ok: false; error: string } {
  const [cmd, ...args] = opts.command;
  if (!cmd) return { ok: false, error: "No command provided" };

  const envOverrides = Object.entries(opts.env ?? {})
    .filter(([, value]) => value !== undefined)
    .filter(([key, value]) => value !== process.env[key])
    .map(([key, value]) => `${key}=${value ?? ""}`);

  const tmuxCommand = envOverrides.length
    ? ["env", ...envOverrides, cmd, ...args]
    : [cmd, ...args];

  const result = spawnSync(
    "tmux",
    ["new-session", "-d", "-s", opts.sessionName, "--", ...tmuxCommand],
    { encoding: "utf-8" },
  );

  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? "unknown error";
    return { ok: false, error: `Failed to start tmux session: ${detail}` };
  }

  return { ok: true };
}

export function launchForeground(opts: {
  command: string[];
  env?: Record<string, string>;
}): { pid: number | undefined; wait: () => Promise<number> } {
  const [cmd, ...args] = opts.command;
  if (!cmd) throw new Error("No command provided");

  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...opts.env },
  });

  return {
    pid: child.pid,
    wait: () => new Promise<number>((resolve) => {
      child.on("exit", (code) => resolve(code ?? 0));
      child.on("error", () => resolve(1));
    }),
  };
}
