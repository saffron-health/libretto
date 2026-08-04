/**
 * Convert any thrown value into printable text that includes the stack.
 */
export function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

/**
 * Workflow failure already formatted with its remote stack in `message`/`stack`.
 * CLI prints `stack` for this type instead of inventing a local throw-site stack.
 */
export class WorkflowRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowRunError";
    this.stack = message;
  }
}
