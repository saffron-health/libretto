import type { Page } from "playwright";
import { format, formatWithOptions, type InspectOptions } from "node:util";
import { installInstrumentation } from "../../../shared/instrumentation/index.js";
import { compileExecFunction } from "../exec-compiler.js";
import { createReadonlyExecHelpers } from "../readonly-exec.js";
import type { DaemonExecRepl } from "./exec-repl.js";

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
  execRepl: DaemonExecRepl,
  visualize?: boolean,
): Promise<ExecResponse> {
  if (visualize) {
    await installInstrumentation(targetPage, { visualize: true });
  }

  const helpers = {
    page: targetPage,
    frame: targetPage.mainFrame(),
  };

  const result = await execRepl.run(code, helpers);
  if (!result.ok) {
    throw new DaemonExecError(result.error.message, result.output);
  }
  return { result: result.result, output: result.output };
}

export async function handleReadonlyExec(
  targetPage: Page,
  code: string,
): Promise<ExecResponse> {
  const buffered = createBufferedConsole();
  const helpers = createReadonlyExecHelpers(targetPage, {
    console: buffered.console,
  });
  const helperNames = Object.keys(helpers);
  const fn = compileExecFunction(code, helperNames);
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
