/**
 * Shared helpers for the exec sandbox, used by both the browser daemon
 * (persistent REPL) and the CLI fallback (direct-CDP execution).
 */

import * as moduleBuiltin from "node:module";

type StripTypeScriptTypesFn = (
  code: string,
  options?: { mode?: "strip" | "transform" },
) => string;

const nodeStripTypeScriptTypes = (
  moduleBuiltin as { stripTypeScriptTypes?: StripTypeScriptTypesFn }
).stripTypeScriptTypes;

function withSuppressedStripTypeScriptWarning<T>(action: () => T): T {
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

/**
 * Strip TypeScript type annotations from code using Node's built-in
 * `stripTypeScriptTypes`. Returns the original code unchanged if the
 * API is not available (Node < 22.6).
 */
export function stripTypeScript(code: string): string {
  if (!nodeStripTypeScriptTypes) return code;
  return withSuppressedStripTypeScriptWarning(() =>
    nodeStripTypeScriptTypes(code, { mode: "strip" }),
  );
}

/**
 * Whether the built-in TS type stripping API is available.
 */
export const hasStripTypeScriptTypes = nodeStripTypeScriptTypes != null;

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
