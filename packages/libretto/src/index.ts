// Logger
export { Logger, defaultLogger, type LoggerApi, type MinimalLogger, type LoggerSink, type LogOptions } from "./shared/logger/logger.js";
export {
	createFileLogSink,
	prettyConsoleSink,
	jsonlConsoleSink,
} from "./shared/logger/sinks.js";

// LLM client interface
export type { LLMClient, Message, MessageContentPart } from "./shared/llm/types.js";
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
export { executeRecoveryAgent } from "./runtime/recovery/agent.js";
export { attemptWithRecovery } from "./runtime/recovery/recovery.js";
export {
	detectSubmissionError,
	type KnownSubmissionError,
	type DetectedSubmissionError,
} from "./runtime/recovery/errors.js";

// AI extraction
export { extractFromPage, type ExtractOptions } from "./runtime/extract/extract.js";

// Network helpers
export {
	pageRequest,
	type RequestConfig,
	type PageRequestOptions,
} from "./runtime/network/network.js";

// Download helpers
export {
	downloadViaClick,
	downloadAndSave,
	type DownloadResult,
	type DownloadViaClickOptions,
	type SaveDownloadOptions,
} from "./runtime/download/download.js";

// Debug
export {
	debugPause,
	DebugPauseSignal,
	isDebugPauseSignal,
	type DebugPauseContext,
	type DebugPauseDetails,
} from "./shared/debug/pause.js";

// Config
export {
	isDebugMode,
	isDryRun,
	shouldPauseBeforeMutation,
} from "./shared/config/config.js";

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
	debugPause as runDebugPause,
	DebugPauseSignal as RunDebugPauseSignal,
	isDebugPauseSignal as isRunDebugPauseSignal,
	type DebugPauseContext as RunDebugPauseContext,
	type DebugPauseDetails as RunDebugPauseDetails,
	type LaunchBrowserArgs,
	type BrowserSession,
} from "./shared/run/api.js";

// Workflow helpers
export {
	LibrettoWorkflow,
	LIBRETTO_WORKFLOW_BRAND,
	workflow,
	type LibrettoAuthProfile,
	type LibrettoWorkflowMetadata,
	type LibrettoWorkflowContext,
	type LibrettoWorkflowHandler,
} from "./shared/workflow/workflow.js";
