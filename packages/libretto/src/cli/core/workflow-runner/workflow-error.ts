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
 * Carries the stack captured inside the workflow process across the CLI
 * boundary. `.stack` is set to that remote stack (not the local throw site in
 * execution.ts) so the printed failure still points at workflow file/line.
 */
export class WorkflowRunError extends Error {
  readonly guidance?: string;

  constructor(workflowStack: string, guidance?: string) {
    const summary = workflowStack.split("\n", 1)[0] ?? workflowStack;
    super(summary);
    this.name = "WorkflowRunError";
    this.stack = workflowStack;
    this.guidance = guidance;
  }
}
