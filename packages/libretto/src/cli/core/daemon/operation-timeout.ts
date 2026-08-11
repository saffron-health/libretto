import type { Page } from "playwright";

/** Bounded safety timeout for small control ops (pages, snapshot, auth capture). */
export const CONTROL_OPERATION_TIMEOUT_MS = 60_000;

export type OperationTimeoutDetails = {
  operation: string;
  session: string;
  timeoutMs: number;
  pageId?: string;
};

export type RunWithOperationTimeoutOptions = OperationTimeoutDetails & {
  /**
   * Best-effort cancel when the deadline fires. Called after AbortSignal abort;
   * failures are swallowed so they never mask the timeout error.
   */
  onTimeout?: () => void | Promise<void>;
};

function isExecOperation(operation: string): boolean {
  return operation === "exec" || operation === "readonly-exec";
}

export function formatOperationTimeoutError(
  details: OperationTimeoutDetails,
): string {
  const pagePart =
    details.pageId !== undefined ? `, page: ${details.pageId}` : "";
  const nextStep = isExecOperation(details.operation)
    ? `Raise --timeout for slow work, or rely on Playwright timeouts in the code. If the session looks stuck, close and reopen: libretto close --session ${details.session}`
    : `Retry the command, or close and reopen if the browser is stuck: libretto close --session ${details.session}`;
  return (
    `${details.operation} timed out after ${details.timeoutMs}ms ` +
    `(session: ${details.session}${pagePart}). ${nextStep}`
  );
}

/**
 * Run an operation with an optional wall-clock deadline.
 *
 * When `timeoutMs` is undefined/null, the operation runs with no outer deadline
 * (Playwright/application timeouts apply). When set, abort the signal on expiry,
 * invoke `onTimeout` for best-effort cancel, and reject with a detailed error.
 */
export async function runWithOperationTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T> | T,
  options: Omit<RunWithOperationTimeoutOptions, "timeoutMs"> & {
    timeoutMs?: number | null;
  },
): Promise<T> {
  const { timeoutMs } = options;
  if (timeoutMs == null) {
    return await operation(new AbortController().signal);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `${options.operation} timeoutMs must be a positive number (session: ${options.session}).`,
    );
  }

  const controller = new AbortController();
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => {
      controller.abort();
      void Promise.resolve(options.onTimeout?.()).catch(() => {});
      reject(
        new Error(
          formatOperationTimeoutError({
            operation: options.operation,
            session: options.session,
            timeoutMs,
            pageId: options.pageId,
          }),
        ),
      );
    }, timeoutMs);
  });

  const run = Promise.resolve().then(() => operation(controller.signal));
  try {
    return await Promise.race([run, timeoutPromise]);
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
    // Losing the race must not leave an unhandled rejection.
    void run.catch(() => {});
  }
}

/**
 * Best-effort interrupt for in-page JS (and CDP work tied to it) when a
 * daemon request times out. Does not close the page or session.
 */
export async function interruptPageExecution(page: Page): Promise<void> {
  try {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Runtime.terminateExecution");
    } finally {
      await cdp.detach().catch(() => {});
    }
  } catch {
    // Dead or detached CDP cannot be interrupted; the timeout still unblocks the CLI.
  }
}
