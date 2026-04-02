import type { Locator, Page } from "playwright";
import { condenseDom } from "../../shared/condense-dom/condense-dom.js";

const PAGE_READ_METHODS = new Set(["url", "title", "content"]);
const PAGE_LOCATOR_FACTORY_METHODS = new Set([
  "locator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "getByTestId",
]);

const LOCATOR_READ_METHODS = new Set([
  "textContent",
  "innerText",
  "allTextContents",
  "allInnerTexts",
  "count",
  "isVisible",
  "isHidden",
]);

const LOCATOR_FACTORY_METHODS = new Set([
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
  "first",
  "last",
  "nth",
]);

type ReadonlyExecOptions = {
  onActivity?: () => void;
};

type ReadonlySnapshotPayload = {
  screenshot: {
    mimeType: "image/png";
    bytesBase64: string;
  };
  currentUrl: string;
  pageTitle: string;
  pageHtml: string;
};

const readonlyPageCache = new WeakMap<Page, Page>();
const readonlyLocatorCache = new WeakMap<Locator, Locator>();

function markActivity(onActivity?: () => void): void {
  onActivity?.();
}

export class ReadonlyExecDeniedError extends Error {
  constructor(message: string) {
    super(`ReadonlyExecDenied: ${message}`);
    this.name = "ReadonlyExecDenied";
  }
}

function denyOperation(targetName: "page" | "locator", method: string): never {
  throw new ReadonlyExecDeniedError(
    `${targetName}.${method} is blocked in readonly-exec`,
  );
}

export function wrapLocatorForReadonlyExec(
  locator: Locator,
  options: ReadonlyExecOptions = {},
): Locator {
  const cached = readonlyLocatorCache.get(locator);
  if (cached) return cached;

  const proxy = new Proxy(locator, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }

      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") {
        return value;
      }

      if (LOCATOR_READ_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          markActivity(options.onActivity);
          return result;
        };
      }

      if (LOCATOR_FACTORY_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const nextLocator = value.apply(target, args) as Locator;
          markActivity(options.onActivity);
          return wrapLocatorForReadonlyExec(nextLocator, options);
        };
      }

      return (..._args: unknown[]) => denyOperation("locator", prop);
    },
  });

  readonlyLocatorCache.set(locator, proxy as Locator);
  return proxy as Locator;
}

export function wrapPageForReadonlyExec(
  page: Page,
  options: ReadonlyExecOptions = {},
): Page {
  const cached = readonlyPageCache.get(page);
  if (cached) return cached;

  const proxy = new Proxy(page, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }

      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") {
        return value;
      }

      if (PAGE_READ_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          markActivity(options.onActivity);
          return result;
        };
      }

      if (PAGE_LOCATOR_FACTORY_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const locator = value.apply(target, args) as Locator;
          markActivity(options.onActivity);
          return wrapLocatorForReadonlyExec(locator, options);
        };
      }

      return (..._args: unknown[]) => denyOperation("page", prop);
    },
  });

  readonlyPageCache.set(page, proxy as Page);
  return proxy as Page;
}

function resolveRequestMethod(
  input: RequestInfo | URL,
  init?: RequestInit,
): string {
  const requestMethod =
    typeof Request !== "undefined" && input instanceof Request
      ? input.method
      : undefined;
  return (init?.method ?? requestMethod ?? "GET").toUpperCase();
}

function assertReadonlyRequestBodyAllowed(
  input: RequestInfo | URL,
  init?: RequestInit,
): void {
  if (init?.body !== undefined) {
    throw new ReadonlyExecDeniedError(
      "request bodies are blocked in readonly-exec",
    );
  }

  if (
    typeof Request !== "undefined" &&
    input instanceof Request &&
    input.body !== null
  ) {
    throw new ReadonlyExecDeniedError(
      "request bodies are blocked in readonly-exec",
    );
  }
}

async function captureReadonlySnapshot(
  page: Page,
  options: ReadonlyExecOptions = {},
): Promise<ReadonlySnapshotPayload> {
  const [screenshotBytes, title, html] = await Promise.all([
    page.screenshot({ type: "png" }),
    page.title(),
    page.content(),
  ]);
  markActivity(options.onActivity);

  return {
    screenshot: {
      mimeType: "image/png",
      bytesBase64: screenshotBytes.toString("base64"),
    },
    currentUrl: page.url(),
    pageTitle: title,
    pageHtml: condenseDom(html).html,
  };
}

export function createReadonlyExecHelpers(
  page: Page,
  options: ReadonlyExecOptions = {},
) {
  const readonlyPage = wrapPageForReadonlyExec(page, options);
  const execState: Record<string, unknown> = {};

  return {
    page: readonlyPage,
    state: execState,
    snapshot: async () => await captureReadonlySnapshot(page, options),
    get: async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = resolveRequestMethod(input, init);
      if (method !== "GET" && method !== "HEAD") {
        throw new ReadonlyExecDeniedError(
          `${method} requests are blocked in readonly-exec`,
        );
      }
      assertReadonlyRequestBodyAllowed(input, init);
      markActivity(options.onActivity);
      return await fetch(input, {
        ...init,
        method,
      });
    },
    fetch: () => {
      throw new ReadonlyExecDeniedError(
        "fetch is blocked in readonly-exec; use get() instead",
      );
    },
    console,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    URL,
    Buffer,
  };
}
