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
} from "./shared/logger/logger.js";
export {
  createFileLogSink,
  prettyConsoleSink,
  jsonlConsoleSink,
} from "./shared/logger/sinks.js";

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
} from "./shared/state/index.js";

// Recovery
export {
  executeRecoveryAgent,
  type BrowserAction,
  type RecoveryAgentResult,
  type RecoveryAgentStep,
} from "./runtime/recovery/agent.js";
export { attemptWithRecovery } from "./runtime/recovery/recovery.js";
export {
  detectSubmissionError,
  type KnownSubmissionError,
  type DetectedSubmissionError,
} from "./runtime/recovery/errors.js";
export {
  COMPUTER_USE_RECOVERY_MODELS,
  POPUP_RECOVERY_INSTRUCTION,
  computerUseRecoveryAction,
  createRecoveryPage,
  popupRecoveryAction,
  type ComputerUseRecoveryActionOptions,
  type PopupRecoveryActionOptions,
  type RecoveryActionContext,
  type RecoveryAction,
  type RecoveryActionHandler,
  type RecoveryActionOptions,
  type RecoveryActionResult,
  type RecoveryActionTargetType,
} from "./runtime/recovery/page-fallbacks.js";

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
export { pause } from "./shared/debug/pause.js";

// Instrumentation
export {
  instrumentPage,
  installInstrumentation,
  instrumentContext,
  type InstrumentationOptions,
  type InstrumentedPage,
} from "./shared/instrumentation/instrument.js";

// Visualization
export {
  ensureGhostCursor,
  moveGhostCursor,
  ghostClick,
  hideGhostCursor,
  type GhostCursorOptions,
} from "./shared/visualization/ghost-cursor.js";
export {
  ensureHighlightLayer,
  showHighlight,
  clearHighlights,
  type HighlightOptions,
} from "./shared/visualization/highlight.js";

// Run helpers
export {
  launchBrowser,
  type LaunchBrowserArgs,
  type BrowserSession,
} from "./shared/run/api.js";

// Workflow helpers
export {
  librettoAuthenticate,
  type LibrettoAuthenticateOptions,
} from "./shared/workflow/authenticate.js";
export {
  getDefaultWorkflowFromModuleExports,
  getWorkflowFromModuleExports,
  getWorkflowsFromModuleExports,
  isLibrettoWorkflow,
  LibrettoWorkflow,
  LibrettoWorkflowInputError,
  LIBRETTO_WORKFLOW_BRAND,
  validateWorkflowInput,
  workflow,
  type ExportedLibrettoWorkflow,
  type LibrettoWorkflowContext,
  type LibrettoWorkflowDefinition,
  type LibrettoWorkflowHandler,
  type LibrettoWorkflowOptions,
  type LibrettoWorkflowViewport,
  type WorkflowInputValidator,
} from "./shared/workflow/workflow.js";
export {
  captureAuthProfileStorageState,
  normalizeAuthProfileSite,
  parseAuthProfileSites,
  type AuthProfileStorageState,
} from "./shared/workflow/auth-profile-state.js";
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
