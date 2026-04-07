import type { Locator, Page } from "playwright";

const PAGE_READ_METHODS = new Set([
  "url",
  "title",
  "content",
  "pageErrors",
  "viewportSize",
  "waitForLoadState",
  "waitForRequest",
  "waitForResponse",
  "waitForURL",
]);
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

const PAGE_ALLOWED_PROPERTIES = new Set<string>([]);

const LOCATOR_READ_METHODS = new Set([
  "textContent",
  "innerText",
  "allTextContents",
  "allInnerTexts",
  "ariaSnapshot",
  "boundingBox",
  "count",
  "getAttribute",
  "inputValue",
  "isChecked",
  "isDisabled",
  "isEditable",
  "isEnabled",
  "isVisible",
  "isHidden",
  "waitFor",
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

const LOCATOR_COLLECTION_FACTORY_METHODS = new Set(["all"]);

const LOCATOR_SCROLL_METHODS = new Set(["scrollIntoViewIfNeeded"]);

const LOCATOR_ALLOWED_PROPERTIES = new Set<string>([]);

type ReadonlyExecOptions = {
  onActivity?: () => void;
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
        if (LOCATOR_ALLOWED_PROPERTIES.has(prop)) {
          return value;
        }
        return denyOperation("locator", prop);
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

      if (LOCATOR_COLLECTION_FACTORY_METHODS.has(prop)) {
        return async (...args: unknown[]) => {
          const locators = (await value.apply(target, args)) as Locator[];
          markActivity(options.onActivity);
          return locators.map((locator) =>
            wrapLocatorForReadonlyExec(locator, options),
          );
        };
      }

      if (LOCATOR_SCROLL_METHODS.has(prop)) {
        return async (...args: unknown[]) => {
          await value.apply(target, args);
          markActivity(options.onActivity);
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
        if (PAGE_ALLOWED_PROPERTIES.has(prop)) {
          return value;
        }
        return denyOperation("page", prop);
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

export function createReadonlyExecHelpers(
  page: Page,
  options: ReadonlyExecOptions = {},
) {
  const readonlyPage = wrapPageForReadonlyExec(page, options);
  const execState: Record<string, unknown> = {};

  return {
    page: readonlyPage,
    state: execState,
    // Playwright has no native viewport scroll method — only locator.scrollIntoViewIfNeeded().
    // Arbitrary scrolling requires page.evaluate(), which is blocked by the readonly proxy
    // since it can run arbitrary code. This helper calls evaluate on the raw (unwrapped) page,
    // scoped to just window.scrollBy.
    scrollBy: async (deltaX: number, deltaY: number) => {
      await page.evaluate(
        ([x, y]) => {
          window.scrollBy(x, y);
        },
        [deltaX, deltaY] as const,
      );
      markActivity(options.onActivity);
    },
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
    // Shadows the global Node.js fetch to prevent unrestricted HTTP access.
    // Without this, agent code would fall through to the global fetch (POST, PUT, DELETE, etc.).
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
