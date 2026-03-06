import type { BrowserContext, Page } from "playwright";
import { wrapPageForActionLogging } from "./telemetry";

export type ExecBindings = {
  page: Page;
  context: BrowserContext;
};

type CreateExecBindingsArgs = {
  page: Page;
  context: BrowserContext;
  runId: string;
  onActivity?: () => void;
};

/**
 * Build the page/context objects exposed to the exec sandbox.
 * Phase 1 keeps the current behavior and centralizes binding composition.
 */
export function createExecBindings({
  page,
  context,
  runId,
  onActivity,
}: CreateExecBindingsArgs): ExecBindings {
  wrapPageForActionLogging(page, runId, onActivity);
  return { page, context };
}
