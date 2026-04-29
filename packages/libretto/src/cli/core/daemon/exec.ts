import type { Browser, BrowserContext, Page } from "playwright";
import { installInstrumentation } from "../../../shared/instrumentation/index.js";
import {
  compileExecFunction,
  stripEmptyCatchHandlers,
} from "../exec-compiler.js";
import { createReadonlyExecHelpers } from "../readonly-exec.js";
import { readNetworkLog, readActionLog } from "../telemetry.js";

export async function handleExec(
  targetPage: Page,
  code: string,
  context: BrowserContext,
  browser: Browser,
  execState: Record<string, unknown>,
  session: string,
  visualize?: boolean,
): Promise<{ result: unknown }> {
  const { cleaned } = stripEmptyCatchHandlers(code);

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
    networkLog,
    actionLog,
  };

  const helperNames = Object.keys(helpers);
  const fn = compileExecFunction(cleaned, helperNames);
  const result = await fn(...Object.values(helpers));
  return { result };
}

export async function handleReadonlyExec(
  targetPage: Page,
  code: string,
): Promise<{ result: unknown }> {
  const { cleaned } = stripEmptyCatchHandlers(code);
  const helpers = createReadonlyExecHelpers(targetPage);
  const helperNames = Object.keys(helpers);
  const fn = compileExecFunction(cleaned, helperNames);
  const result = await fn(...Object.values(helpers));
  return { result };
}
