import * as repl from "node:repl";
import { PassThrough } from "node:stream";
import { stripTypeScriptExecCode } from "../exec-compiler.js";

const PROMPT = "__LIBRETTO_EXEC_REPL_READY__";
const TOP_LEVEL_RETURN_HINT =
  "Hint: top-level return isn't supported because exec is a REPL-style environment. Use the expression value instead, for example: await page.title()";
const NO_RESULT = Symbol("NO_RESULT");

type ActiveEval = {
  output: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
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

export class DaemonExecRepl {
  private readonly replServer: repl.REPLServer;
  private readonly input = new PassThrough();
  private readonly output = new PassThrough();
  private readyResolve: (() => void) | undefined;
  private readonly ready: Promise<void>;
  private activeEval: ActiveEval | undefined;
  private lastResult: unknown = NO_RESULT;

  constructor() {
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
      terminal: false,
      useGlobal: false,
      writer: (value: unknown) => {
        this.lastResult = value;
        return "";
      },
    });
  }

  async run(
    code: string,
    globals: Record<string, unknown>,
  ): Promise<unknown> {
    Object.assign(this.replServer.context, globals);

    let jsCode: string;
    try {
      jsCode = stripTypeScriptExecCode(code);
    } catch (error) {
      if (isTopLevelReturnError(error)) {
        throw appendTopLevelReturnHint(error);
      }
      throw error;
    }

    await this.ready;
    return await new Promise<unknown>((resolve, reject) => {
      this.activeEval = { output: "", resolve, reject };
      this.lastResult = NO_RESULT;
      this.input.write(`${jsCode}\n`);
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
    if (isErrorLike(result)) {
      active.reject(
        isTopLevelReturnError(result)
          ? appendTopLevelReturnHint(result)
          : toError(result),
      );
      return;
    }
    active.resolve(result);
  }
}
