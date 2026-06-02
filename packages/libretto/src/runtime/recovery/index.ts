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
  POPUP_RECOVERY_INSTRUCTION,
  createFallbackPage,
  popupRecoveryFallback,
  visionRecoveryFallback,
  type FallbackTargetType,
  type PageFallbackContext,
  type PageFallback,
  type PageFallbackHandler,
  type PageFallbackOptions,
  type PageFallbackResult,
  type PopupRecoveryFallbackOptions,
  type VisionRecoveryFallbackOptions,
} from "./page-fallbacks.js";
