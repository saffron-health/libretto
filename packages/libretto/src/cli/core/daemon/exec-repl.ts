import * as repl from "node:repl";
import { PassThrough } from "node:stream";
import { format, formatWithOptions, type InspectOptions } from "node:util";
import { stripTypeScriptExecCode } from "../exec-compiler.js";

const PROMPT = "__LIBRETTO_EXEC_REPL_READY__";
const TOP_LEVEL_RETURN_HINT =
  "Hint: top-level return isn't supported because exec is a REPL-style environment. Use the expression value instead, for example: await page.title()";
const NO_RESULT = Symbol("NO_RESULT");

type ReplOutput = {
  stdout: string;
  stderr: string;
};

export type DaemonExecReplResult = {
  ok: true;
  result: unknown;
  output: ReplOutput;
};

export type DaemonExecReplFailure = {
  ok: false;
  error: Error;
  output: ReplOutput;
};

export type DaemonExecReplResponse = DaemonExecReplResult | DaemonExecReplFailure;

type ActiveEval = {
  output: string;
  consoleOutput: ReplOutput;
  resolve: (value: DaemonExecReplResponse) => void;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

function isTopLevelReturnError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("Illegal return statement") ||
    message.includes("Return statement is not allowed here")
  );
}

function isErrorLike(value: unknown): boolean {
  return (
    value instanceof Error ||
    (typeof value === "object" &&
      value !== null &&
      "name" in value &&
      "message" in value &&
      typeof value.name === "string" &&
      typeof value.message === "string")
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(getErrorMessage(value));
}

function appendTopLevelReturnHint(error: unknown): Error {
  const message = getErrorMessage(error);
  if (message.includes(TOP_LEVEL_RETURN_HINT)) {
    return error instanceof Error ? error : new Error(message);
  }
  return new SyntaxError(`${message}\n\n${TOP_LEVEL_RETURN_HINT}`);
}

function createBufferedConsole(): { console: Console; output: ReplOutput } {
  const output: ReplOutput = { stdout: "", stderr: "" };
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

export class DaemonExecRepl {
  private readonly replServer: repl.REPLServer;
  private readonly input = new PassThrough();
  private readonly output = new PassThrough();
  private readyResolve: (() => void) | undefined;
  private readonly ready: Promise<void>;
  private activeEval: ActiveEval | undefined;
  private lastResult: unknown = NO_RESULT;

  constructor(globals: Record<string, unknown>) {
    this.ready = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
    this.output.on("data", (chunk: Buffer | string) => {
      this.handleOutput(String(chunk));
    });
    this.replServer = repl.start({
      prompt: PROMPT,
      input: this.input,
      output: this.output,
      terminal: true,
      useGlobal: false,
      writer: (value: unknown) => {
        this.lastResult = value;
        return "";
      },
    });
    Object.assign(this.replServer.context, globals);
  }

  async run(
    code: string,
    globals: Record<string, unknown>,
  ): Promise<DaemonExecReplResponse> {
    Object.assign(this.replServer.context, globals);

    let jsCode: string;
    try {
      jsCode = stripTypeScriptExecCode(code);
    } catch (error) {
      return {
        ok: false,
        error: isTopLevelReturnError(error)
          ? appendTopLevelReturnHint(error)
          : toError(error),
        output: { stdout: "", stderr: "" },
      };
    }

    await this.ready;
    const buffered = createBufferedConsole();
    Object.assign(this.replServer.context, { console: buffered.console });
    return await new Promise<DaemonExecReplResponse>((resolve) => {
      this.activeEval = { output: "", consoleOutput: buffered.output, resolve };
      this.lastResult = NO_RESULT;
      this.input.write(`.editor\n${jsCode}\n\x04`);
    });
  }

  private handleOutput(chunk: string): void {
    const active = this.activeEval;
    if (!active) {
      if (chunk.includes(PROMPT)) {
        this.readyResolve?.();
        this.readyResolve = undefined;
      }
      return;
    }

    active.output += chunk;
    if (!active.output.includes(PROMPT)) return;

    this.activeEval = undefined;
    const result = this.lastResult === NO_RESULT ? undefined : this.lastResult;
    const output = active.consoleOutput;
    if (isErrorLike(result)) {
      const error = isTopLevelReturnError(result)
        ? appendTopLevelReturnHint(result)
        : toError(result);
      active.resolve({ ok: false, error, output });
      return;
    }
    active.resolve({ ok: true, result, output });
  }
}
