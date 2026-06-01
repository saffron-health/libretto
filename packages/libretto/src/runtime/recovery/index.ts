export {
  executeRecoveryAgent,
  type BrowserAction,
  type RecoveryAgentResult,
  type RecoveryAgentStep,
} from "./agent.js";
export { attemptWithRecovery } from "./recovery.js";
export {
  detectSubmissionError,
  type KnownSubmissionError,
  type DetectedSubmissionError,
} from "./errors.js";
export {
  createFallbackPage,
  popupClosingFallback,
  type FallbackTargetType,
  type PageFallbackContext,
  type PageFallback,
  type PageFallbackHandler,
  type PageFallbackOptions,
  type PageFallbackResult,
  type PopupClosingFallbackOptions,
} from "./page-fallbacks.js";
