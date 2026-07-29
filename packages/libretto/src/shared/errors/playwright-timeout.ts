import { errors } from "playwright";

const TIMEOUT_EXCEEDED_PREFIX = /^(.*?Timeout \d+ms exceeded\.)(.*)$/;

const ACTIONABILITY_PATTERNS: RegExp[] = [
  /^element is not (?:visible|enabled|stable|editable)$/i,
  /^element is outside of the viewport$/i,
  /^did not find some options$/i,
  /^option being selected is not enabled$/i,
  /^.+ intercepts pointer events$/i,
];

/**
 * True for Playwright action/navigation timeouts.
 * Prefer `instanceof errors.TimeoutError`; also accept the `name` fallback for
 * re-wrapped or cross-realm errors that lose the prototype.
 */
export function isPlaywrightTimeoutError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (error instanceof errors.TimeoutError) return true;
  return (
    error.name === "TimeoutError" &&
    /Timeout \d+ms exceeded/i.test(error.message)
  );
}

/**
 * Promote the last Call-log actionability failure into the timeout headline.
 * Stock Playwright keeps the reason only in the Call log; this lifts it into
 * the first line so agents see it immediately.
 */
export function enrichPlaywrightTimeoutMessage(message: string): string {
  const lines = message.split("\n");
  const firstLine = lines[0] ?? "";
  const match = firstLine.match(TIMEOUT_EXCEEDED_PREFIX);
  if (!match) return message;

  const [, timeoutPrefix = "", existingReason = ""] = match;
  if (existingReason.trim()) return message;

  const callLogStart = lines.findIndex((line) => line.trim() === "Call log:");
  const callLogText =
    callLogStart >= 0 ? lines.slice(callLogStart + 1).join("\n") : message;
  const rawReason = lastActionabilityReason(callLogText);
  if (!rawReason) return message;

  lines[0] = `${timeoutPrefix} ${formatActionabilityReason(rawReason)}`;
  return lines.join("\n");
}

/** Format thrown values for agent-facing Libretto CLI / daemon error strings. */
export function formatPlaywrightErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!isPlaywrightTimeoutError(error) && !isTimeoutErrorMessage(message)) {
    return message;
  }
  return enrichPlaywrightTimeoutMessage(message);
}

function isTimeoutErrorMessage(message: string): boolean {
  return (
    /Timeout \d+ms exceeded/i.test(message) && message.includes("Call log:")
  );
}

function lastActionabilityReason(callLogText: string): string | null {
  let last: string | null = null;
  for (const rawLine of callLogText.split("\n")) {
    const line = rawLine.replace(/^\s*-\s*/, "").trim();
    if (!line) continue;
    if (ACTIONABILITY_PATTERNS.some((pattern) => pattern.test(line))) {
      last = line;
    }
  }
  return last;
}

function formatActionabilityReason(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  if (lower === "element is not visible") {
    return (
      "Element is not visible — it may be hidden by CSS, inside a collapsed " +
      "<details>, inactive tab, or closed accordion. Reveal it first, then retry."
    );
  }

  if (lower.endsWith("intercepts pointer events")) {
    return (
      `${normalized} — run libretto snapshot and interact with the covering ` +
      "element (modal/overlay), then retry."
    );
  }

  if (lower.startsWith("element is not ")) {
    return `Element is not ${normalized.slice("element is not ".length)}`;
  }
  if (lower === "element is outside of the viewport") {
    return "Element is outside of the viewport";
  }
  if (lower === "did not find some options") {
    return "Did not find some options";
  }
  if (lower === "option being selected is not enabled") {
    return "Option being selected is not enabled";
  }
  return normalized;
}
