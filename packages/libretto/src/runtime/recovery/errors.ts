import type { Page } from "playwright";
import {
  type MinimalLogger,
  defaultLogger,
} from "../../shared/logger/logger.js";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

/**
 * Known error type for classifying submission errors.
 * errorPatterns are what the LLM should look for on screen.
 * userMessage is the friendly message returned when matched.
 */
export type KnownSubmissionError = {
  id: string;
  errorPatterns: string[];
  userMessage: string;
};

export type DetectedSubmissionError = {
  matched: true;
  errorId: string;
  message: string;
};

const detectSubmissionErrorSchema = z.object({
  hasError: z.boolean().describe("Whether an error is visible on the page"),
  matchedKnownErrorId: z
    .string()
    .nullable()
    .describe("The ID of the matched known error, or null if no match"),
  errorMessage: z
    .string()
    .nullable()
    .describe("The error message visible on screen, or null if no error"),
});

/**
 * Uses screenshot + LLM vision to detect if an error occurred during a submission process.
 * Captures a screenshot via CDP (handles unresponsive pages), sends it to the LLM,
 * and checks against the provided known error patterns.
 *
 * @returns DetectedSubmissionError if a known error is matched
 * @throws The original error if no known error matches
 */
export async function detectSubmissionError(
  page: Page,
  error: unknown,
  logContext: string,
  model: LanguageModel,
  knownErrors: KnownSubmissionError[] = [],
  logger?: MinimalLogger,
): Promise<DetectedSubmissionError> {
  const log = logger ?? defaultLogger;
  // Capture screenshot using CDP to handle unresponsive pages
  let screenshot: string;
  let domSnapshot: string | undefined;

  try {
    const cdpClient = await page.context().newCDPSession(page);
    await cdpClient.send("Page.enable");
    const { data } = await cdpClient.send("Page.captureScreenshot", {
      format: "png",
    });
    screenshot = data;
  } catch (screenshotError) {
    log.warn(
      "Failed to take screenshot via CDP for error detection, skipping LLM analysis",
      { screenshotError, originalError: error },
    );
    throw error;
  }

  // Capture DOM snapshot for additional context
  try {
    const htmlContent = await page.content();
    domSnapshot =
      htmlContent.length > 50000
        ? htmlContent.slice(0, 50000) + "\n... [truncated]"
        : htmlContent;
  } catch (domError) {
    log.warn("Failed to capture DOM snapshot", {
      domError: domError instanceof Error ? domError.message : String(domError),
    });
  }

  const knownErrorsDescription =
    knownErrors.length > 0
      ? `\nKnown error patterns to look for:\n${knownErrors.map((e, i) => `${i + 1}. ID: "${e.id}" - Patterns: ${e.errorPatterns.join(", ")}`).join("\n")}\n`
      : "";

  const prompt = `You are analyzing a screenshot and DOM of a web page to detect if an error occurred during a browser automation process.

Context: ${logContext}

${knownErrorsDescription}

Analyze the screenshot and DOM snapshot to determine:
1. Is there any error message, warning, or indication of failure visible on the page?
2. If yes, does it match any of the known error patterns listed above?
3. What is the exact error message or description of the problem?

IMPORTANT:
- Look carefully for error alerts, warning banners, error modals, red text, or any indication of failure
- Check the DOM snapshot for error messages that may not be visible in the screenshot
- If you see a known error pattern, use its exact ID in matchedKnownErrorId
- If there's an error but it doesn't match any known pattern, set matchedKnownErrorId to null
- If the page looks normal with no errors, set hasError to false

${domSnapshot ? `<dom_snapshot>\n${domSnapshot}\n</dom_snapshot>` : ""}`;

  const { object: result } = await generateObject({
    model,
    schema: detectSubmissionErrorSchema,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: `data:image/png;base64,${screenshot}` },
        ],
      },
    ],
    temperature: 0,
  });

  if (!result.hasError) {
    log.info("No error detected by LLM", { result });
  }

  // Check if it matches a known error
  if (result.matchedKnownErrorId) {
    const knownError = knownErrors.find(
      (e) => e.id === result.matchedKnownErrorId,
    );
    if (knownError) {
      log.warn(logContext, {
        error,
        browserError: result.errorMessage,
        knownErrorId: result.matchedKnownErrorId,
      });
      return {
        matched: true,
        errorId: knownError.id,
        message: knownError.userMessage,
      };
    }
  }

  // Log and re-throw for unknown errors
  log.warn(logContext, {
    error,
    browserError: result.errorMessage,
  });
  throw error;
}
