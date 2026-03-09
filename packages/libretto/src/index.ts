// Step runner
export { step } from "./step/step.js";
export { createRunner, type Runner } from "./step/runner.js";
export type {
	Step,
	StepOptions,
	StepContext,
	StepHandler,
	RecoveryHandler,
	RunnerConfig,
	StepHistoryEntry,
	DebugBundle,
} from "./step/types.js";

// Logger
export { Logger, type LoggerApi, type LoggerSink, type LogOptions } from "./logger/logger.js";
export {
	createFileLogSink,
	prettyConsoleSink,
	jsonlConsoleSink,
} from "./logger/sinks.js";

// LLM client interface
export type { LLMClient, Message, MessageContentPart } from "./llm/types.js";
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
} from "./state/index.js";

// Recovery
export { executeRecoveryAgent } from "./recovery/agent.js";
export { attemptWithRecovery } from "./recovery/recovery.js";
export {
	detectSubmissionError,
	type KnownSubmissionError,
	type DetectedSubmissionError,
} from "./recovery/errors.js";

// AI extraction
export { extractFromPage, type ExtractOptions } from "./extract/extract.js";

// Network helpers
export {
	pageRequest,
	type RequestConfig,
	type PageRequestOptions,
} from "./network/network.js";

// Download helpers
export {
	downloadViaClick,
	downloadAndSave,
	type DownloadResult,
	type DownloadViaClickOptions,
	type SaveDownloadOptions,
} from "./download/download.js";

// Debug
export {
	debugPause,
	DebugPauseSignal,
	isDebugPauseSignal,
	type DebugPauseContext,
	type DebugPauseDetails,
} from "./debug/pause.js";

// Config
export {
	isDebugMode,
	isDryRun,
	shouldPauseBeforeMutation,
} from "./config/config.js";

// Instrumentation
export {
	instrumentPage,
	installInstrumentation,
	instrumentContext,
	type InstrumentationOptions,
	type InstrumentedPage,
} from "./instrumentation/instrument.js";

// Visualization
export {
	ensureGhostCursor,
	moveGhostCursor,
	ghostClick,
	hideGhostCursor,
	type GhostCursorOptions,
} from "./visualization/ghost-cursor.js";
export {
	ensureHighlightLayer,
	showHighlight,
	clearHighlights,
	type HighlightOptions,
} from "./visualization/highlight.js";

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
} from "./run/api.js";

// Workflow helpers
export {
	LibrettoWorkflow,
	LIBRETTO_WORKFLOW_BRAND,
	workflow,
	type LibrettoAuthProfile,
	type LibrettoWorkflowMetadata,
	type LibrettoWorkflowContext,
	type LibrettoWorkflowHandler,
} from "./workflow/workflow.js";
