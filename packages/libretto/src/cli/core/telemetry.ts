import {
  appendFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import type { Page } from "playwright";
import {
  getSessionActionsLogPath,
  getSessionNetworkLogPath,
} from "./context.js";
import { assertSessionStateExistsOrThrow } from "./session.js";

export type NetworkLogEntry = {
  ts: string;
  pageId?: string;
  method: string;
  url: string;
  status: number;
  contentType: string | null;
  postData?: string;
  responseBody?: string | null;
  size: number | null;
  durationMs: number | null;
};

export function readNetworkLog(
  session: string,
  opts: {
    last?: number;
    filter?: string;
    method?: string;
    pageId?: string;
  } = {},
): NetworkLogEntry[] {
  assertSessionStateExistsOrThrow(session);
  const logPath = getSessionNetworkLogPath(session);
  if (!existsSync(logPath)) return [];

  const lines = readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean);
  let entries: NetworkLogEntry[] = lines.map(
    (line) => JSON.parse(line) as NetworkLogEntry,
  );

  if (opts.method) {
    const m = opts.method.toUpperCase();
    entries = entries.filter((e) => e.method === m);
  }
  if (opts.filter) {
    const re = new RegExp(opts.filter, "i");
    entries = entries.filter((e) => re.test(e.url));
  }
  if (opts.pageId) {
    entries = entries.filter((e) => e.pageId === opts.pageId);
  }

  const last = opts.last ?? 20;
  if (entries.length > last) {
    entries = entries.slice(-last);
  }

  return entries;
}

export type ActionLogEntry = {
  ts: string;
  pageId?: string;
  action: string;
  source: "user" | "agent";
  selector?: string;
  bestSemanticSelector?: string;
  targetSelector?: string;
  ancestorSelectors?: string[];
  nearbyText?: string;
  composedPath?: string[];
  coordinates?: {
    x: number;
    y: number;
  };
  value?: string;
  url?: string;
  duration?: number;
  success: boolean;
  error?: string;
};

export function parentLogAction(
  session: string,
  entry: Record<string, unknown>,
): void {
  try {
    const record = { ts: new Date().toISOString(), ...entry };
    appendFileSync(
      getSessionActionsLogPath(session),
      JSON.stringify(record) + "\n",
    );
  } catch {}
}

export function readActionLog(
  session: string,
  opts: {
    last?: number;
    filter?: string;
    action?: string;
    source?: string;
    pageId?: string;
  } = {},
): ActionLogEntry[] {
  assertSessionStateExistsOrThrow(session);
  const logPath = getSessionActionsLogPath(session);
  if (!existsSync(logPath)) return [];

  const lines = readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean);
  let entries: ActionLogEntry[] = lines.map(
    (line) => JSON.parse(line) as ActionLogEntry,
  );

  if (opts.action) {
    const a = opts.action.toLowerCase();
    entries = entries.filter((e) => e.action === a);
  }
  if (opts.source) {
    const s = opts.source.toLowerCase();
    entries = entries.filter((e) => e.source === s);
  }
  if (opts.filter) {
    const re = new RegExp(opts.filter, "i");
    entries = entries.filter(
      (e) =>
        re.test(e.action) ||
        re.test(e.selector || "") ||
        re.test(e.bestSemanticSelector || "") ||
        re.test(e.targetSelector || "") ||
        re.test((e.ancestorSelectors || []).join(" ")) ||
        re.test(e.nearbyText || "") ||
        re.test((e.composedPath || []).join(" ")) ||
        re.test(e.value || "") ||
        re.test(e.url || ""),
    );
  }
  if (opts.pageId) {
    entries = entries.filter((e) => e.pageId === opts.pageId);
  }

  const last = opts.last ?? 20;
  if (entries.length > last) {
    entries = entries.slice(-last);
  }

  return entries;
}

const LOCATOR_ACTION_METHODS = [
  "click",
  "dblclick",
  "fill",
  "type",
  "press",
  "check",
  "uncheck",
  "selectOption",
  "hover",
  "focus",
  "scrollIntoViewIfNeeded",
  "waitFor",
  "innerHTML",
  "innerText",
  "textContent",
  "inputValue",
  "isChecked",
  "isDisabled",
  "isEditable",
  "isEnabled",
  "isHidden",
  "isVisible",
  "count",
  "boundingBox",
  "screenshot",
  "evaluate",
  "evaluateAll",
  "evaluateHandle",
  "getAttribute",
  "dispatchEvent",
  "setInputFiles",
  "selectText",
  "dragTo",
  "highlight",
  "tap",
] as const;

const LOCATOR_RETURNING_METHODS = [
  "first",
  "last",
  "locator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "getByTestId",
  "filter",
  "and",
  "or",
] as const;

function formatHint(method: string, args: any[]): string {
  const formatted = args.map((a: any) => JSON.stringify(a)).join(", ");
  return `${method}(${formatted})`;
}

function wrapLocator(
  locator: any,
  hint: string,
  session: string,
  page: Page,
  pageId?: string,
  onActivity?: () => void,
): any {
  if (locator.__librettoActionLogged) return locator;
  locator.__librettoActionLogged = true;

  for (const actMethod of LOCATOR_ACTION_METHODS) {
    if (typeof locator[actMethod] !== "function") continue;
    const origAct = locator[actMethod].bind(locator);
    locator[actMethod] = async (...actArgs: any[]) => {
      const start = Date.now();
      try {
        await page.evaluate(() => {
          (window as any).__btApiActionInProgress = true;
        });
      } catch {}
      try {
        const result = await origAct(...actArgs);
        parentLogAction(session, {
          pageId,
          action: actMethod,
          source: "agent",
          selector: hint,
          value:
            actArgs[0] !== undefined
              ? String(actArgs[0]).slice(0, 100)
              : undefined,
          duration: Date.now() - start,
          success: true,
        });
        onActivity?.();
        return result;
      } catch (err: any) {
        parentLogAction(session, {
          pageId,
          action: actMethod,
          source: "agent",
          selector: hint,
          duration: Date.now() - start,
          success: false,
          error: err.message,
        });
        onActivity?.();
        throw err;
      } finally {
        try {
          await page.evaluate(() => {
            (window as any).__btApiActionInProgress = false;
          });
        } catch {}
      }
    };
  }

  for (const method of LOCATOR_RETURNING_METHODS) {
    if (typeof locator[method] !== "function") continue;
    const origMethod = locator[method].bind(locator);
    locator[method] = (...args: any[]) => {
      const child = origMethod(...args);
      const childHint =
        args.length > 0
          ? `${hint}.${formatHint(method, args)}`
          : `${hint}.${method}()`;
      return wrapLocator(child, childHint, session, page, pageId, onActivity);
    };
  }

  if (typeof locator.nth === "function") {
    const origNth = locator.nth.bind(locator);
    locator.nth = (index: number) => {
      const child = origNth(index);
      const childHint = `${hint}.nth(${index})`;
      return wrapLocator(child, childHint, session, page, pageId, onActivity);
    };
  }

  if (typeof locator.all === "function") {
    const origAll = locator.all.bind(locator);
    locator.all = async () => {
      const items: any[] = await origAll();
      return items.map((item: any, i: number) => {
        const childHint = `${hint}.all()[${i}]`;
        return wrapLocator(item, childHint, session, page, pageId, onActivity);
      });
    };
  }

  return locator;
}

export function wrapPageForActionLogging(
  page: Page,
  session: string,
  pageId?: string,
  onActivity?: () => void,
): void {
  const PAGE_ACTIONS = [
    "click",
    "dblclick",
    "fill",
    "type",
    "press",
    "check",
    "uncheck",
    "selectOption",
    "hover",
    "focus",
  ] as const;
  const NAV_ACTIONS = ["goto", "reload", "goBack", "goForward"] as const;

  for (const method of PAGE_ACTIONS) {
    const orig = (page as any)[method].bind(page);
    (page as any)[method] = async (...args: any[]) => {
      const start = Date.now();
      try {
        await page.evaluate(() => {
          (window as any).__btApiActionInProgress = true;
        });
      } catch {}
      try {
        const result = await orig(...args);
        parentLogAction(session, {
          pageId,
          action: method,
          source: "agent",
          selector: typeof args[0] === "string" ? args[0] : undefined,
          value:
            args[1] !== undefined ? String(args[1]).slice(0, 100) : undefined,
          duration: Date.now() - start,
          success: true,
        });
        onActivity?.();
        return result;
      } catch (err: any) {
        parentLogAction(session, {
          pageId,
          action: method,
          source: "agent",
          selector: typeof args[0] === "string" ? args[0] : undefined,
          duration: Date.now() - start,
          success: false,
          error: err.message,
        });
        onActivity?.();
        throw err;
      } finally {
        try {
          await page.evaluate(() => {
            (window as any).__btApiActionInProgress = false;
          });
        } catch {}
      }
    };
  }

  for (const method of NAV_ACTIONS) {
    const orig = (page as any)[method].bind(page);
    (page as any)[method] = async (...args: any[]) => {
      const start = Date.now();
      try {
        const result = await orig(...args);
        parentLogAction(session, {
          pageId,
          action: method,
          source: "agent",
          url: typeof args[0] === "string" ? args[0] : page.url(),
          duration: Date.now() - start,
          success: true,
        });
        onActivity?.();
        return result;
      } catch (err: any) {
        parentLogAction(session, {
          pageId,
          action: method,
          source: "agent",
          url: typeof args[0] === "string" ? args[0] : undefined,
          duration: Date.now() - start,
          success: false,
          error: err.message,
        });
        onActivity?.();
        throw err;
      }
    };
  }

  const LOCATOR_FACTORIES = [
    "locator",
    "getByRole",
    "getByText",
    "getByLabel",
    "getByPlaceholder",
    "getByAltText",
    "getByTitle",
    "getByTestId",
  ] as const;

  for (const factory of LOCATOR_FACTORIES) {
    const orig = (page as any)[factory].bind(page);
    (page as any)[factory] = (...factoryArgs: any[]) => {
      const locator = orig(...factoryArgs);
      const hint = formatHint(factory, factoryArgs);
      return wrapLocator(locator, hint, session, page, pageId, onActivity);
    };
  }
}
