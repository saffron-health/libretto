import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Page } from "playwright";
import { join } from "node:path";
import { getRunDir, getSessionStateOrThrow } from "./session";

export type NetworkLogEntry = {
  ts: string;
  method: string;
  url: string;
  status: number;
  contentType: string | null;
  postData?: string;
  responseBody?: string | null;
  size: number | null;
  durationMs: number | null;
};

export function getNetworkLogPath(runId: string): string {
  return join(getRunDir(runId), "network.jsonl");
}

export function readNetworkLog(
  session: string,
  opts: { last?: number; filter?: string; method?: string } = {},
): NetworkLogEntry[] {
  const state = getSessionStateOrThrow(session);
  const logPath = getNetworkLogPath(state.runId);
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

  const last = opts.last ?? 20;
  if (entries.length > last) {
    entries = entries.slice(-last);
  }

  return entries;
}

export function formatNetworkEntry(e: NetworkLogEntry): string {
  const time = e.ts.replace(/.*T/, "").replace(/\.\d+Z$/, "");
  const duration = e.durationMs != null ? `${e.durationMs}ms` : "?ms";
  const size = e.size != null ? `${e.size}B` : "";
  const parts = [
    `[${time}]`,
    `${e.status}`,
    `${e.method.padEnd(6)}`,
    e.url,
    duration,
    size,
  ].filter(Boolean);
  let line = parts.join(" ");
  if (e.postData) {
    line += `\n         body: ${e.postData.substring(0, 120)}${e.postData.length > 120 ? "..." : ""}`;
  }
  return line;
}

export function clearNetworkLog(session: string): void {
  const state = getSessionStateOrThrow(session);
  const logPath = getNetworkLogPath(state.runId);
  writeFileSync(logPath, "");
}

export type ActionLogEntry = {
  ts: string;
  action: string;
  source: "user" | "agent";
  selector?: string;
  value?: string;
  url?: string;
  duration?: number;
  success: boolean;
  error?: string;
};

export function getActionLogPath(runId: string): string {
  return join(getRunDir(runId), "actions.jsonl");
}

export function parentLogAction(
  runId: string,
  entry: Record<string, unknown>,
): void {
  try {
    const record = { ts: new Date().toISOString(), ...entry };
    appendFileSync(getActionLogPath(runId), JSON.stringify(record) + "\n");
  } catch {}
}

export function readActionLog(
  session: string,
  opts: {
    last?: number;
    filter?: string;
    action?: string;
    source?: string;
  } = {},
): ActionLogEntry[] {
  const state = getSessionStateOrThrow(session);
  const logPath = getActionLogPath(state.runId);
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
        re.test(e.value || "") ||
        re.test(e.url || ""),
    );
  }

  const last = opts.last ?? 20;
  if (entries.length > last) {
    entries = entries.slice(-last);
  }

  return entries;
}

export function formatActionEntry(e: ActionLogEntry): string {
  const time = e.ts.replace(/.*T/, "").replace(/\.\d+Z$/, "");
  const src = e.source.toUpperCase().padEnd(5);
  const parts = [`[${time}]`, `[${src}]`, e.action];
  if (e.selector) parts.push(e.selector);
  if (e.value) parts.push(`"${e.value}"`);
  if (e.url) parts.push(e.url);
  if (e.duration != null) parts.push(`${e.duration}ms`);
  if (!e.success) parts.push(`ERROR: ${e.error || "unknown"}`);
  return parts.join(" ");
}

export function clearActionLog(session: string): void {
  const state = getSessionStateOrThrow(session);
  const logPath = getActionLogPath(state.runId);
  writeFileSync(logPath, "");
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
  runId: string,
  page: Page,
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
        parentLogAction(runId, {
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
        parentLogAction(runId, {
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
      return wrapLocator(child, childHint, runId, page, onActivity);
    };
  }

  if (typeof locator.nth === "function") {
    const origNth = locator.nth.bind(locator);
    locator.nth = (index: number) => {
      const child = origNth(index);
      const childHint = `${hint}.nth(${index})`;
      return wrapLocator(child, childHint, runId, page, onActivity);
    };
  }

  if (typeof locator.all === "function") {
    const origAll = locator.all.bind(locator);
    locator.all = async () => {
      const items: any[] = await origAll();
      return items.map((item: any, i: number) => {
        const childHint = `${hint}.all()[${i}]`;
        return wrapLocator(item, childHint, runId, page, onActivity);
      });
    };
  }

  return locator;
}

export function wrapPageForActionLogging(
  page: Page,
  runId: string,
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
        parentLogAction(runId, {
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
        parentLogAction(runId, {
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
        parentLogAction(runId, {
          action: method,
          source: "agent",
          url: typeof args[0] === "string" ? args[0] : page.url(),
          duration: Date.now() - start,
          success: true,
        });
        onActivity?.();
        return result;
      } catch (err: any) {
        parentLogAction(runId, {
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
      return wrapLocator(locator, hint, runId, page, onActivity);
    };
  }
}
