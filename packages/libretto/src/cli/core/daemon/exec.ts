import type { Browser, BrowserContext, Page } from "playwright";
import { format, formatWithOptions, type InspectOptions } from "node:util";
import { installInstrumentation } from "../../../shared/instrumentation/index.js";
import {
  compileExecFunction,
  stripEmptyCatchHandlers,
} from "../exec-compiler.js";
import { createReadonlyExecHelpers } from "../readonly-exec.js";
import { readNetworkLog, readActionLog } from "../telemetry.js";

type ExecOutput = {
  stdout: string;
  stderr: string;
};

export class DaemonExecError extends Error {
  constructor(
    message: string,
    readonly output: ExecOutput,
  ) {
    super(message);
    this.name = "DaemonExecError";
  }
}

type ExecResponse = {
  result: unknown;
  output: ExecOutput;
};

function createBufferedConsole(): { console: Console; output: ExecOutput } {
  const output: ExecOutput = { stdout: "", stderr: "" };
  const writeStdout = (...args: unknown[]) => {
    output.stdout += `${format(...args)}\n`;
  };
  const writeStderr = (...args: unknown[]) => {
    output.stderr += `${format(...args)}\n`;
  };

  const bufferedConsole = {
    ...globalThis.console,
    log: writeStdout,
    info: writeStdout,
    debug: writeStdout,
    dir: (value?: unknown, options?: InspectOptions) => {
      output.stdout += `${formatWithOptions(options ?? {}, value)}\n`;
    },
    warn: writeStderr,
    error: writeStderr,
  } satisfies Console;

  return { console: bufferedConsole, output };
}

export async function handleExec(
  targetPage: Page,
  code: string,
  context: BrowserContext,
  browser: Browser,
  execState: Record<string, unknown>,
  session: string,
  visualize?: boolean,
): Promise<ExecResponse> {
  const { cleaned } = stripEmptyCatchHandlers(code);
  const buffered = createBufferedConsole();

  if (visualize) {
    await installInstrumentation(targetPage, { visualize: true });
  }

  const networkLog = (
    opts: {
      last?: number;
      filter?: string;
      method?: string;
      pageId?: string;
    } = {},
  ) => readNetworkLog(session, opts);

  const actionLog = (
    opts: {
      last?: number;
      filter?: string;
      action?: string;
      source?: string;
      pageId?: string;
    } = {},
  ) => readActionLog(session, opts);

  const helpers = {
    page: targetPage,
    context,
    browser,
    state: execState,
    console: buffered.console,
    networkLog,
    actionLog,
  };

  const helperNames = Object.keys(helpers);
  const fn = compileExecFunction(cleaned, helperNames);
  try {
    const result = await fn(...Object.values(helpers));
    return { result, output: buffered.output };
  } catch (error) {
    throw new DaemonExecError(
      error instanceof Error ? error.message : String(error),
      buffered.output,
    );
  }
}

export async function handleReadonlyExec(
  targetPage: Page,
  code: string,
): Promise<ExecResponse> {
  const { cleaned } = stripEmptyCatchHandlers(code);
  const buffered = createBufferedConsole();
  const helpers = createReadonlyExecHelpers(targetPage, {
    console: buffered.console,
  });
  const helperNames = Object.keys(helpers);
  const fn = compileExecFunction(cleaned, helperNames);
  try {
    const result = await fn(...Object.values(helpers));
    return { result, output: buffered.output };
  } catch (error) {
    throw new DaemonExecError(
      error instanceof Error ? error.message : String(error),
      buffered.output,
    );
  }
}
