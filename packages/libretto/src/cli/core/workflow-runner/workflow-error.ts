const WORKFLOW_STAY_OPEN_GUIDANCE =
  "Browser is still open. You can use `exec` to inspect it. Call `run` to re-run the workflow.";

export const WORKFLOW_STAY_OPEN_GUIDANCE_MESSAGE = WORKFLOW_STAY_OPEN_GUIDANCE;

/**
 * Convert any thrown value into a printable message that includes the stack.
 * Walks `cause` so nested failures stay visible without structured serialization.
 */
export function errorToMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts: string[] = [error.stack ?? `${error.name}: ${error.message}`];
  let cause: unknown = error.cause;
  let depth = 0;
  while (cause !== undefined && cause !== null && depth < 8) {
    depth += 1;
    if (cause instanceof Error) {
      parts.push(
        `Caused by: ${cause.stack ?? `${cause.name}: ${cause.message}`}`,
      );
      cause = cause.cause;
      continue;
    }
    parts.push(`Caused by: ${String(cause)}`);
    break;
  }
  return parts.join("\n");
}

export function workflowFailureMessage(
  error: unknown,
  options: { includeStayOpenGuidance?: boolean } = {},
): string {
  const message = errorToMessage(error);
  if (!options.includeStayOpenGuidance) {
    return message;
  }
  return `${message}\n${WORKFLOW_STAY_OPEN_GUIDANCE}`;
}
