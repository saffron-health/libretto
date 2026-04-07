import type { Page } from "playwright";
import {
  type MinimalLogger,
  defaultLogger,
} from "../../shared/logger/logger.js";
import type { LanguageModel } from "ai";
import { executeRecoveryAgent } from "./agent.js";

/**
 * Attempts to execute a function, and if it fails, runs popup recovery
 * (if an LLM client is provided) and retries the function once.
 */
export async function attemptWithRecovery<T>(
  page: Page,
  fn: () => Promise<T>,
  logger?: MinimalLogger,
  model?: LanguageModel,
): Promise<T> {
  const log = logger ?? defaultLogger;
  try {
    return await fn();
  } catch (error) {
    // Don't attempt recovery if the browser/page is closed
    if (
      error instanceof Error &&
      (error.message.includes("Target closed") ||
        error.message.includes("browser has been closed") ||
        error.message.includes("context or browser has been closed"))
    ) {
      log.warn("Page/browser has been closed, cannot recover", {
        error: error.message,
      });
      throw error;
    }

    if (!model) {
      throw error;
    }

    log.info("Action failed, attempting popup recovery", {
      error: error instanceof Error ? error.message : String(error),
    });

    await executeRecoveryAgent(
      page,
      "Look at the page to see if there is a popup blocking the screen. If so, close the popup.",
      log,
      model,
    );

    return await fn();
  }
}
