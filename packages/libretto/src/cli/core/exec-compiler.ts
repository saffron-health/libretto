/**
 * Shared exec compilation utilities.
 *
 * Used by both the daemon (browser-daemon.ts) and the connect-based
 * session path (execution.ts) to compile user-provided code strings
 * into callable async functions.
 */

import * as moduleBuiltin from "node:module";

export type ExecFunction = (...args: unknown[]) => Promise<unknown>;

type StripTypeScriptTypesFn = (
  code: string,
  options?: { mode?: "strip" | "transform" },
) => string;

const stripTypeScriptTypes = (
  moduleBuiltin as { stripTypeScriptTypes?: StripTypeScriptTypesFn }
).stripTypeScriptTypes;

export function withSuppressedStripTypeScriptWarning<T>(action: () => T): T {
  type EmitWarningFn = (...args: unknown[]) => void;
  const mutableProcess = process as unknown as { emitWarning: EmitWarningFn };
  const originalEmitWarning = mutableProcess.emitWarning;

  mutableProcess.emitWarning = (...args: unknown[]) => {
    const warning = args[0];
    const typeOrOptions = args[1];
    const warningMessage =
      typeof warning === "string"
        ? warning
        : warning instanceof Error
          ? warning.message
          : "";
    const warningType =
      typeof typeOrOptions === "string"
        ? typeOrOptions
        : typeof typeOrOptions === "object" &&
            typeOrOptions !== null &&
            "type" in typeOrOptions &&
            typeof (typeOrOptions as { type?: unknown }).type === "string"
          ? ((typeOrOptions as { type?: string }).type ?? "")
          : "";

    if (
      warningType === "ExperimentalWarning" &&
      warningMessage.includes("stripTypeScriptTypes")
    ) {
      return;
    }
    originalEmitWarning(...args);
  };

  try {
    return action();
  } finally {
    mutableProcess.emitWarning = originalEmitWarning;
  }
}

export function compileTypeScriptExecFunction(
  code: string,
  helperNames: string[],
): ExecFunction | null {
  if (!stripTypeScriptTypes) return null;

  const wrappedSource = `(async function __librettoExec(${helperNames.join(", ")}) {\n${code}\n})`;
  const jsSource = withSuppressedStripTypeScriptWarning(() =>
    stripTypeScriptTypes(wrappedSource, { mode: "strip" }),
  );
  const createFunction = new Function(
    `return ${jsSource}`,
  ) as () => ExecFunction;
  return createFunction();
}

export function compileExecFunction(
  code: string,
  helperNames: string[],
): ExecFunction {
  const typeStripped = compileTypeScriptExecFunction(code, helperNames);
  if (typeStripped) return typeStripped;

  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as new (...args: string[]) => ExecFunction;
  return new AsyncFunction(...helperNames, code);
}

/**
 * Strip `.catch(() => {})` / `?.catch(() => {})` from executable code,
 * skipping occurrences inside string literals (single, double, backtick)
 * and single-line / multi-line comments so we never corrupt non-code text.
 */
export function stripEmptyCatchHandlers(code: string): {
  cleaned: string;
  strippedCount: number;
} {
  const catchRe = /\??\s*\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/g;
  let strippedCount = 0;
  let result = "";
  let i = 0;

  while (i < code.length) {
    // Single-line comment
    if (code[i] === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i);
      const slice = end === -1 ? code.slice(i) : code.slice(i, end + 1);
      result += slice;
      i += slice.length;
      continue;
    }
    // Multi-line comment
    if (code[i] === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      const slice = end === -1 ? code.slice(i) : code.slice(i, end + 2);
      result += slice;
      i += slice.length;
      continue;
    }
    // String literals
    if (code[i] === '"' || code[i] === "'" || code[i] === "`") {
      const quote = code[i];
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === "\\" && quote !== "`") {
          j += 2;
          continue;
        }
        if (code[j] === "\\" && quote === "`") {
          j += 2;
          continue;
        }
        if (code[j] === quote) {
          j++;
          break;
        }
        // Template literal interpolation — skip nested braces
        if (quote === "`" && code[j] === "$" && code[j + 1] === "{") {
          let depth = 1;
          j += 2;
          while (j < code.length && depth > 0) {
            if (code[j] === "{") depth++;
            else if (code[j] === "}") depth--;
            j++;
          }
          continue;
        }
        j++;
      }
      result += code.slice(i, j);
      i = j;
      continue;
    }
    // Try to match the catch pattern at the current position
    catchRe.lastIndex = i;
    const match = catchRe.exec(code);
    if (match && match.index === i) {
      strippedCount++;
      i += match[0].length;
      continue;
    }
    // Regular character
    result += code[i];
    i++;
  }

  return { cleaned: result, strippedCount };
}
