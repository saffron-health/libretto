import { relative } from "node:path";
import {
  deserializeError,
  serializeError,
  type ErrorObject,
} from "serialize-error";

export type WorkflowErrorSerializationOptions = {
  cwd?: string;
  integrationPath?: string;
};

export type SerializedWorkflowError = ErrorObject;

const WORKFLOW_STAY_OPEN_GUIDANCE =
  "Browser is still open. You can use `exec` to inspect it. Call `run` to re-run the workflow.";

export const WORKFLOW_STAY_OPEN_GUIDANCE_MESSAGE = WORKFLOW_STAY_OPEN_GUIDANCE;

type StackFrameKind = "workflow" | "libretto" | "playwright" | "other";

type ParsedStackFrame = {
  raw: string;
  functionName?: string;
  filePath?: string;
  line?: number;
  column?: number;
  kind: StackFrameKind;
};

const FRAME_WITH_FUNCTION =
  /^\s*at\s+(?<fn>.+?)\s+\((?<loc>.+)\)$/;
const FRAME_WITHOUT_FUNCTION = /^\s*at\s+(?<loc>.+)$/;
const LOCATION_WITH_POSITION =
  /^(?<path>.*?):(?<line>\d+):(?<column>\d+)$/;

/**
 * Build an actionable workflow failure Error:
 * - Outer error prioritizes workflow frames (then Libretto, then Playwright)
 * - Original Playwright/runtime error is preserved as `cause`
 * - Sensitive custom properties are stripped before IPC serialization
 */
export function createWorkflowFailureError(
  error: unknown,
  options: WorkflowErrorSerializationOptions = {},
): Error {
  const original = toError(error);
  const summary = summarizeErrorMessage(original);
  const frames = parseStackFrames(original.stack ?? "", options);
  const prioritized = prioritizeFrames(frames);

  const cause = sanitizeErrorTree(original);
  const wrapped = new Error(summary, { cause });
  wrapped.name = original.name || "Error";
  wrapped.stack = formatNamedStack(wrapped.name, summary, prioritized);
  return wrapped;
}

export function serializeWorkflowError(
  error: Error,
): SerializedWorkflowError {
  return serializeError(sanitizeErrorTree(error));
}

export function deserializeWorkflowError(
  value: unknown,
): Error {
  return deserializeError(value);
}

export function formatErrorWithCauses(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts: string[] = [error.stack ?? `${error.name}: ${error.message}`];
  let cause: unknown = error.cause;
  let depth = 0;
  while (cause !== undefined && cause !== null && depth < 8) {
    depth += 1;
    if (cause instanceof Error) {
      const causeStack = cause.stack ?? `${cause.name}: ${cause.message}`;
      parts.push(`Caused by: ${causeStack}`);
      cause = cause.cause;
      continue;
    }
    parts.push(`Caused by: ${String(cause)}`);
    break;
  }
  return parts.join("\n");
}

export function formatWorkflowRunFailure(
  error: unknown,
  options: { includeStayOpenGuidance?: boolean } = {},
): string {
  const formatted = formatErrorWithCauses(error);
  if (!options.includeStayOpenGuidance) {
    return formatted;
  }
  return `${formatted}\n${WORKFLOW_STAY_OPEN_GUIDANCE}`;
}

export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}

function sanitizeErrorTree(error: Error): Error {
  const cause =
    error.cause instanceof Error
      ? sanitizeErrorTree(error.cause)
      : undefined;
  const clean = cause
    ? new Error(error.message, { cause })
    : new Error(error.message);
  clean.name = error.name;
  if (error.stack !== undefined) {
    clean.stack = error.stack;
  }
  return clean;
}

function summarizeErrorMessage(error: Error): string {
  const firstLine = error.message.split("\n", 1)[0]?.trim() ?? error.message;
  const timeoutMatch = firstLine.match(
    /^(?<api>\S+):\s*Timeout\s+(?<ms>\d+)ms\s+exceeded\b/i,
  );
  if (timeoutMatch?.groups?.api && timeoutMatch.groups.ms) {
    return `${timeoutMatch.groups.api} timed out after ${timeoutMatch.groups.ms}ms`;
  }
  return firstLine;
}

function parseStackFrames(
  stack: string,
  options: WorkflowErrorSerializationOptions,
): ParsedStackFrame[] {
  const frames: ParsedStackFrame[] = [];
  for (const line of stack.split("\n")) {
    if (!/^\s*at\s+/.test(line)) continue;
    const parsed = parseStackFrameLine(line, options);
    if (parsed) frames.push(parsed);
  }
  return frames;
}

function parseStackFrameLine(
  line: string,
  options: WorkflowErrorSerializationOptions,
): ParsedStackFrame | undefined {
  const withFn = line.match(FRAME_WITH_FUNCTION);
  const withoutFn = withFn ? null : line.match(FRAME_WITHOUT_FUNCTION);
  const fn = withFn?.groups?.fn?.trim();
  const loc = (withFn?.groups?.loc ?? withoutFn?.groups?.loc)?.trim();
  if (!loc) {
    return {
      raw: line.trimEnd(),
      functionName: fn,
      kind: "other",
    };
  }

  const location = parseLocation(loc);
  const filePath = location?.filePath
    ? relativizePath(location.filePath, options.cwd)
    : undefined;
  const kind = classifyFrame({
    filePath: location?.filePath ?? filePath,
    integrationPath: options.integrationPath,
  });

  return {
    raw: formatFrameLine({
      functionName: fn,
      filePath: filePath ?? location?.filePath,
      line: location?.line,
      column: location?.column,
      fallback: line.trim(),
    }),
    functionName: fn,
    filePath: filePath ?? location?.filePath,
    line: location?.line,
    column: location?.column,
    kind,
  };
}

function parseLocation(
  loc: string,
): { filePath: string; line: number; column: number } | undefined {
  let value = loc;
  if (value.startsWith("file://")) {
    value = value.slice("file://".length);
  }
  const match = value.match(LOCATION_WITH_POSITION);
  if (!match?.groups?.path || !match.groups.line || !match.groups.column) {
    return undefined;
  }
  return {
    filePath: match.groups.path,
    line: Number(match.groups.line),
    column: Number(match.groups.column),
  };
}

function relativizePath(filePath: string, cwd = process.cwd()): string {
  if (filePath.startsWith("node:")) return filePath;
  if (!filePath.startsWith("/")) return filePath;
  const relativePath = relative(cwd, filePath);
  if (!relativePath || relativePath.startsWith("..")) {
    return filePath;
  }
  return relativePath;
}

function classifyFrame(args: {
  filePath?: string;
  integrationPath?: string;
}): StackFrameKind {
  const filePath = args.filePath ?? "";
  const normalized = filePath.replaceAll("\\", "/");

  if (
    normalized.startsWith("node:") ||
    normalized.includes("/node_modules/tsx/") ||
    normalized.includes("/node_modules/esbuild/")
  ) {
    return "other";
  }

  if (
    normalized.includes("/node_modules/playwright/") ||
    normalized.includes("/node_modules/playwright-core/") ||
    normalized.includes("/playwright-core/")
  ) {
    return "playwright";
  }

  if (
    normalized.includes("/node_modules/libretto/") ||
    normalized.includes("/packages/libretto/") ||
    /\/libretto\/(dist|src)\//.test(normalized)
  ) {
    return "libretto";
  }

  if (args.integrationPath) {
    const integration = args.integrationPath.replaceAll("\\", "/");
    if (
      normalized === integration ||
      normalized.endsWith(integration) ||
      integration.endsWith(normalized)
    ) {
      return "workflow";
    }
  }

  if (
    normalized.length > 0 &&
    !normalized.includes("/node_modules/") &&
    !normalized.startsWith("node:")
  ) {
    return "workflow";
  }

  return "other";
}

function prioritizeFrames(frames: ParsedStackFrame[]): ParsedStackFrame[] {
  const workflow = frames.filter((frame) => frame.kind === "workflow");
  const libretto = frames.filter((frame) => frame.kind === "libretto");
  const playwright = frames.filter((frame) => frame.kind === "playwright");
  const other = frames.filter((frame) => frame.kind === "other");

  const prioritized = [...workflow, ...libretto, ...playwright];
  if (prioritized.length > 0) {
    return prioritized;
  }
  // Fall back to whatever frames we have so async/callback errors still show something.
  return [...other];
}

function formatNamedStack(
  name: string,
  message: string,
  frames: ParsedStackFrame[],
): string {
  const header = `${name}: ${message}`;
  if (frames.length === 0) {
    return header;
  }
  return [header, ...frames.map((frame) => `    ${frame.raw.replace(/^\s*/, "")}`)].join(
    "\n",
  );
}

function formatFrameLine(args: {
  functionName?: string;
  filePath?: string;
  line?: number;
  column?: number;
  fallback: string;
}): string {
  const { functionName, filePath, line, column, fallback } = args;
  if (!filePath || line === undefined || column === undefined) {
    return fallback.replace(/^\s*/, "");
  }
  const location = `${filePath}:${line}:${column}`;
  if (functionName) {
    return `at ${functionName} (${location})`;
  }
  return `at ${location}`;
}
