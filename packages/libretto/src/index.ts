import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Logger
export {
  Logger,
  defaultLogger,
  type LoggerApi,
  type MinimalLogger,
  type LoggerSink,
  type LogOptions,
} from "./runtime/logger/logger.js";
export {
  createFileLogSink,
  prettyConsoleSink,
  jsonlConsoleSink,
} from "./runtime/logger/sinks.js";

export {
  SESSION_STATE_VERSION,
  SessionStatusSchema,
  SessionStateFileSchema,
  parseSessionStateData,
  parseSessionStateContent,
  serializeSessionState,
  type SessionStatus,
  type SessionState,
  type SessionStateFile,
} from "./runtime/state/index.js";

// Recovery
export { executeRecoveryAgent } from "./runtime/recovery/agent.js";
export { attemptWithRecovery } from "./runtime/recovery/recovery.js";
export {
  detectSubmissionError,
  type KnownSubmissionError,
  type DetectedSubmissionError,
} from "./runtime/recovery/errors.js";

// AI extraction
export {
  extractFromPage,
  type ExtractOptions,
} from "./runtime/extract/extract.js";

// Network helpers
export {
  pageRequest,
  type RequestConfig,
  type PageRequestOptions,
} from "./runtime/network/network.js";

// Download helpers
export {
  downloadViaClick,
  type DownloadResult,
  type DownloadViaClickOptions,
} from "./runtime/download/download.js";

// Debug / Pause
export { pause } from "./runtime/debug/pause.js";

// Instrumentation
export {
  instrumentPage,
  installInstrumentation,
  instrumentContext,
  type InstrumentationOptions,
  type InstrumentedPage,
} from "./runtime/instrumentation/instrument.js";

// Visualization
export {
  ensureGhostCursor,
  moveGhostCursor,
  ghostClick,
  hideGhostCursor,
  type GhostCursorOptions,
} from "./runtime/visualization/ghost-cursor.js";
export {
  ensureHighlightLayer,
  showHighlight,
  clearHighlights,
  type HighlightOptions,
} from "./runtime/visualization/highlight.js";

// Run helpers
export {
  launchBrowser,
  type LaunchBrowserArgs,
  type BrowserSession,
} from "./runtime/run/api.js";

// Workflow helpers
export {
  getDefaultWorkflowFromModuleExports,
  getWorkflowFromModuleExports,
  getWorkflowsFromModuleExports,
  isLibrettoWorkflow,
  LibrettoWorkflow,
  LIBRETTO_WORKFLOW_BRAND,
  workflow,
  type ExportedLibrettoWorkflow,
  type LibrettoWorkflowContext,
  type LibrettoWorkflowHandler,
} from "./runtime/workflow/workflow.js";
const isDirectExecution = (): boolean => {
  const entryArg = process.argv[1];
  if (!entryArg) {
    return false;
  }
  return pathToFileURL(resolve(entryArg)).href === import.meta.url;
};

if (isDirectExecution()) {
  void import("./cli/index.js").catch((error: unknown) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
