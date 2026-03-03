// --- Job definition ---
export { defineJob, defineJobs } from "./define.js";
export { createLocalRunner, type LocalRunner } from "./typed-runner.js";

// --- Registry ---
export { registerJobs, getRegisteredJobs, listRegisteredJobTypes, resolveRegisteredJob, findJobTypeByDefinition } from "./registry.js";

// --- Runtime (for integration entrypoints) ---
export { parseRuntimeArgs, runRegisteredJob, type RunRegisteredJobInput } from "./runtime.js";

// --- Browser ---
export { launchBrowser, type LaunchBrowserArgs, type BrowserSession } from "./browser.js";

// --- Launch + lifecycle ---
export { launchJob, getJobStatus, stopJob, waitForPause, resumeJob } from "./launcher.js";

// --- Debug pause (for use inside job handlers) ---
export { debugPause } from "./pause.js";

// --- Types ---
export type {
  AnyJobDef,
  JobsMap,
  JobDefParams,
  LocalRunnerJobContext,
  JobLaunchInput,
  LaunchConfig,
  JobLaunchResult,
  JobStatus,
} from "./types.js";
