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
} from "./page-fallbacks.js";
