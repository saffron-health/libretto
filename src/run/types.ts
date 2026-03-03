import type { Page } from "playwright";
import type { LoggerApi } from "../logger/logger.js";
import type { ZodTypeAny, output as ZodOutput } from "zod";

// --- Job definition types (from local-runner/types.ts, unchanged) ---

export type LocalRunnerJobContext<TParams> = {
  page: Page;
  logger: LoggerApi;
  params: TParams;
};

export type AnyJobDef = {
  schema: ZodTypeAny;
  run: (ctx: LocalRunnerJobContext<any>) => Promise<void>;
};

export type JobsMap = Record<string, AnyJobDef>;

export type JobDefParams<TJob extends AnyJobDef> = ZodOutput<TJob["schema"]>;

// --- Launch types (NEW) ---

export type LaunchConfig = {
  headless?: boolean;
  foreground?: boolean;
  repoRoot?: string;
  registryPath?: string;
  runtimeCommand?: {
    command: string;
    argsPrefix?: string[];
  };
  io?: {
    logFile?: string;
    signalDir?: string;
    stateDir?: string;
  };
};

export type JobLaunchInput = {
  jobType: string;
  params: unknown;
  session?: string;
  config?: LaunchConfig;
};

export type JobLaunchResult = {
  jobId: string;
  session: string;
  mode: "background" | "foreground";
  logFile: string;
  command: { command: string; args: string[] };
  startedAt: string;
};

export type JobStatus = {
  running: boolean;
  session: string;
  mode?: "background" | "foreground";
  logFile?: string;
  startedAt?: string;
  command?: string;
  args?: Record<string, unknown>;
  lastError?: { timestamp: string; message: string };
};

// --- Internal types ---

export type SessionState = {
  session: string;
  jobId: string;
  jobType: string;
  mode: "background" | "foreground";
  logFile: string;
  startedAt: string;
  pid?: number;
  tmuxSession?: string;
  command: string;
  args: string[];
};

export type PausePayload = {
  session: string;
  pausedAt: string;
  pid: number;
  url?: string;
};
