import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { JobLaunchInput, JobLaunchResult, JobStatus, LaunchConfig, SessionState } from "./types.js";
import { resolveLogFile, resolveEntrypoint, resolveRegistryPath } from "./paths.js";
import { saveSessionState, loadSessionState, deleteSessionState } from "./state.js";
import { isTmuxAvailable, tmuxSessionExists, killTmuxSession, ensureLogFile, launchInTmux, launchForeground } from "./process.js";
import { waitForPauseSignal, writeResumeSignal } from "./pause.js";

// --- Error helper ---

function runnerError(code: string, message: string): Error {
  const err = new Error(message);
  (err as any).code = code;
  return err;
}

// --- Command building ---

function buildCommand(input: JobLaunchInput): { command: string; args: string[] } {
  const headless = input.config?.headless === true;
  const runtimeCommand = input.config?.runtimeCommand;
  const cmd = runtimeCommand?.command ?? "bun";
  const prefix = runtimeCommand?.argsPrefix ?? [];
  const entrypoint = resolveEntrypoint(input.config);
  const registryPath = resolveRegistryPath(input.config);

  const generatedArgs = [
    entrypoint,
    "--job-type", input.jobType,
    "--params", JSON.stringify(input.params ?? {}),
    "--debug-mode",
  ];

  if (registryPath) {
    generatedArgs.push("--registry", registryPath);
  }

  if (!headless) {
    generatedArgs.push("--headed");
  }

  return { command: cmd, args: [...prefix, ...generatedArgs] };
}

function buildEnv(session: string, logFile: string): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    NODE_ENV: process.env.NODE_ENV || "development",
    BROWSER_AGENT_DEBUG_MODE: "true",
    BROWSER_AGENT_LOG_FILE: logFile,
    BROWSER_AGENT_SESSION_NAME: session,
  };
}

// --- launchJob ---

export async function launchJob(input: JobLaunchInput): Promise<JobLaunchResult> {
  if (!input.jobType) {
    throw runnerError("JOB_LAUNCH_VALIDATION_ERROR", "jobType is required");
  }

  const session = input.session ?? randomUUID();
  const logFile = resolveLogFile(session, input.config);
  const foreground = input.config?.foreground === true;
  const mode = foreground ? "foreground" : "background";
  const jobId = randomUUID();
  const startedAt = new Date().toISOString();

  // Session collision check (background only)
  if (!foreground && tmuxSessionExists(session)) {
    const existing = loadSessionState(session, input.config);
    throw runnerError(
      "JOB_ALREADY_RUNNING",
      `Session "${session}" is already running.${existing ? ` Started at ${existing.startedAt}, jobType: ${existing.jobType}` : ""}`,
    );
  }

  const { command, args } = buildCommand(input);
  const env = buildEnv(session, logFile);
  ensureLogFile(logFile);

  if (foreground) {
    const proc = launchForeground({ command: [command, ...args], env });

    saveSessionState({
      session, jobId, jobType: input.jobType, mode: "foreground",
      logFile, startedAt, pid: proc.pid, command, args,
    }, input.config);

    return { jobId, session, mode: "foreground", logFile, command: { command, args }, startedAt };
  }

  // Background (tmux)
  if (!isTmuxAvailable()) {
    throw runnerError("JOB_LAUNCH_TMUX_UNAVAILABLE", "tmux is required for background mode. Use config.foreground=true to run without tmux.");
  }

  const result = launchInTmux({ sessionName: session, command: [command, ...args], env });
  if (!result.ok) {
    throw runnerError("JOB_LAUNCH_START_FAILED", result.error);
  }

  saveSessionState({
    session, jobId, jobType: input.jobType, mode: "background",
    logFile, startedAt, tmuxSession: session, command, args,
  }, input.config);

  return { jobId, session, mode: "background", logFile, command: { command, args }, startedAt };
}

// --- getJobStatus ---

export async function getJobStatus(input: {
  session: string;
  config?: Pick<LaunchConfig, "io" | "repoRoot">;
}): Promise<JobStatus> {
  const running = tmuxSessionExists(input.session);
  const state = loadSessionState(input.session, input.config);

  if (!state) return { running, session: input.session };

  const status: JobStatus = {
    running, session: input.session, mode: state.mode,
    logFile: state.logFile, startedAt: state.startedAt, command: state.command,
  };

  // Best-effort: parse last error from log file
  try {
    if (existsSync(state.logFile)) {
      const lines = readFileSync(state.logFile, "utf-8").trim().split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const line = JSON.parse(lines[i]!);
          if (line.level === "error") {
            status.lastError = { timestamp: line.timestamp, message: line.event || line.message || "Unknown error" };
            break;
          }
        } catch {}
      }
    }
  } catch {}

  return status;
}

// --- stopJob ---

export async function stopJob(input: {
  session: string;
  config?: Pick<LaunchConfig, "io" | "repoRoot">;
}): Promise<{ stopped: boolean }> {
  const killed = killTmuxSession(input.session);
  deleteSessionState(input.session, input.config);
  return { stopped: killed };
}

// --- waitForPause ---

export async function waitForPause(input: {
  session: string;
  config?: Pick<LaunchConfig, "io" | "repoRoot">;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{ pausedAt?: string; url?: string; pid?: number }> {
  return waitForPauseSignal(input);
}

// --- resumeJob ---

export async function resumeJob(input: {
  session: string;
  config?: Pick<LaunchConfig, "io" | "repoRoot">;
}): Promise<{ signaled: boolean }> {
  return { signaled: writeResumeSignal(input.session, input.config) };
}
