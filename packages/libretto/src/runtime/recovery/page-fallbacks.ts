import type { FrameLocator, Locator, Page } from "playwright";
import type { LanguageModel } from "ai";
import { executeRecoveryAgent, type RecoveryAgentResult } from "./agent.js";

export type FallbackTargetType = "page" | "locator";

export type PageFallbackContext = {
  page: Page;
  targetType: FallbackTargetType;
  method: string;
  args: readonly unknown[];
  error: unknown;
};

export type PageFallbackResult = Record<string, unknown> | void;

export type PageFallbackHandler = (
  context: PageFallbackContext,
) => Promise<PageFallbackResult>;

export type PageFallback = PageFallbackHandler;

export type PageFallbackOptions = {
  fallback: PageFallback;
};

type VisionRecoveryModelOptions =
  | {
      model: LanguageModel;
    }
  | {
      provider: "openai" | "anthropic";
      apiKey: string;
      model: string;
    };

export type VisionRecoveryFallbackOptions = VisionRecoveryModelOptions & {
  instruction: string;
  maxSteps?: number;
};

export type PopupRecoveryFallbackOptions = VisionRecoveryModelOptions & {
  maxSteps?: number;
};

export const POPUP_RECOVERY_INSTRUCTION = [
  "Look at the page for any popup, modal, cookie banner, overlay, dialog, or interstitial that blocks interaction.",
  "If any blocking popup is visible, close it before returning done.",
  "Prefer obvious close, dismiss, continue, accept, or X buttons.",
  "Do not return done while a blocking overlay or dialog is still visible.",
].join(" ");

const PAGE_UI_METHODS = new Set([
  "click",
  "dblclick",
  "tap",
  "hover",
  "fill",
  "type",
  "press",
  "pressSequentially",
  "check",
  "uncheck",
  "setChecked",
  "selectOption",
  "setInputFiles",
  "selectText",
  "dispatchEvent",
  "focus",
  "blur",
  "dragAndDrop",
]);

const PAGE_READ_METHODS = new Set([
  "title",
  "content",
  "screenshot",
  "waitForLoadState",
  "waitForRequest",
  "waitForResponse",
  "waitForURL",
]);

const LOCATOR_UI_METHODS = new Set([
  "click",
  "dblclick",
  "tap",
  "hover",
  "fill",
  "type",
  "press",
  "pressSequentially",
  "check",
  "uncheck",
  "setChecked",
  "selectOption",
  "setInputFiles",
  "selectText",
  "dispatchEvent",
  "focus",
  "blur",
  "clear",
  "dragTo",
  "scrollIntoViewIfNeeded",
]);

const LOCATOR_READ_METHODS = new Set([
  "textContent",
  "innerText",
  "innerHTML",
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
  "screenshot",
  "waitFor",
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

const FRAME_LOCATOR_FACTORY_METHODS = new Set([
  "locator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "getByTestId",
  "owner",
  "first",
  "last",
  "nth",
  "frameLocator",
]);

function isUiMethod(targetType: FallbackTargetType, method: string): boolean {
  return targetType === "page"
    ? PAGE_UI_METHODS.has(method)
    : LOCATOR_UI_METHODS.has(method);
}

function isReadMethod(targetType: FallbackTargetType, method: string): boolean {
  return targetType === "page"
    ? PAGE_READ_METHODS.has(method)
    : LOCATOR_READ_METHODS.has(method);
}

function isSupportedMethod(
  targetType: FallbackTargetType,
  method: string,
): boolean {
  return isUiMethod(targetType, method) || isReadMethod(targetType, method);
}

async function runWithFallback<T>(args: {
  page: Page;
  targetType: FallbackTargetType;
  method: string;
  methodArgs: readonly unknown[];
  invoke: () => T | Promise<T>;
  options: PageFallbackOptions;
}): Promise<T> {
  try {
    return await args.invoke();
  } catch (originalError) {
    const baseContext = {
      page: args.page,
      targetType: args.targetType,
      method: args.method,
      args: args.methodArgs,
    } as const;
    if (!isSupportedMethod(baseContext.targetType, baseContext.method)) {
      throw originalError;
    }

    try {
      await args.options.fallback({
        ...baseContext,
        error: originalError,
      });
      return await args.invoke();
    } catch {
      throw originalError;
    }
  }
}

type ProxyCaches = {
  locators: WeakMap<Locator, Locator>;
  frameLocators: WeakMap<FrameLocator, FrameLocator>;
};

function bindOrWrapLocatorMethod(
  locator: Locator,
  rawPage: Page,
  method: string,
  value: unknown,
  options: PageFallbackOptions,
  caches: ProxyCaches,
): unknown {
  if (typeof value !== "function") return value;

  if (LOCATOR_FACTORY_METHODS.has(method)) {
    return (...args: unknown[]) => {
      const nextLocator = value.apply(locator, args) as Locator;
      return createFallbackLocator(nextLocator, rawPage, options, caches);
    };
  }

  if (method === "all") {
    return async (...args: unknown[]) => {
      const locators = (await value.apply(locator, args)) as Locator[];
      return locators.map((nextLocator) =>
        createFallbackLocator(nextLocator, rawPage, options, caches),
      );
    };
  }

  if (method === "contentFrame") {
    return (...args: unknown[]) => {
      const frameLocator = value.apply(locator, args) as FrameLocator;
      return createFallbackFrameLocator(frameLocator, rawPage, options, caches);
    };
  }

  if (!isSupportedMethod("locator", method)) {
    return value.bind(locator);
  }

  return (...args: unknown[]) =>
    runWithFallback({
      page: rawPage,
      targetType: "locator",
      method,
      methodArgs: args,
      invoke: () => value.apply(locator, args),
      options,
    });
}

function createFallbackLocator(
  locator: Locator,
  rawPage: Page,
  options: PageFallbackOptions,
  caches: ProxyCaches,
): Locator {
  const cached = caches.locators.get(locator);
  if (cached) return cached;

  const proxy = new Proxy(locator, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }
      return bindOrWrapLocatorMethod(
        target,
        rawPage,
        prop,
        Reflect.get(target, prop, target),
        options,
        caches,
      );
    },
  }) as Locator;

  caches.locators.set(locator, proxy);
  return proxy;
}

function createFallbackFrameLocator(
  frameLocator: FrameLocator,
  rawPage: Page,
  options: PageFallbackOptions,
  caches: ProxyCaches,
): FrameLocator {
  const cached = caches.frameLocators.get(frameLocator);
  if (cached) return cached;

  const proxy = new Proxy(frameLocator, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;

      if (FRAME_LOCATOR_FACTORY_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          if (prop === "first" || prop === "last" || prop === "nth") {
            return createFallbackFrameLocator(
              result as FrameLocator,
              rawPage,
              options,
              caches,
            );
          }
          if (prop === "frameLocator") {
            return createFallbackFrameLocator(
              result as FrameLocator,
              rawPage,
              options,
              caches,
            );
          }
          return createFallbackLocator(
            result as Locator,
            rawPage,
            options,
            caches,
          );
        };
      }

      return value.bind(target);
    },
  }) as FrameLocator;

  caches.frameLocators.set(frameLocator, proxy);
  return proxy;
}

export function createFallbackPage(
  page: Page,
  options: PageFallbackOptions,
): Page {
  const caches: ProxyCaches = {
    locators: new WeakMap(),
    frameLocators: new WeakMap(),
  };

  return new Proxy(page, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }

      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;

      if (PAGE_LOCATOR_FACTORY_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const locator = value.apply(target, args) as Locator;
          return createFallbackLocator(locator, page, options, caches);
        };
      }

      if (prop === "frameLocator") {
        return (...args: unknown[]) => {
          const frameLocator = value.apply(target, args) as FrameLocator;
          return createFallbackFrameLocator(frameLocator, page, options, caches);
        };
      }

      if (!isSupportedMethod("page", prop)) {
        return value.bind(target);
      }

      return (...args: unknown[]) =>
        runWithFallback({
          page,
          targetType: "page",
          method: prop,
          methodArgs: args,
          invoke: () => value.apply(target, args),
          options,
        });
    },
  }) as Page;
}

async function resolveVisionRecoveryModel(
  options: VisionRecoveryFallbackOptions,
): Promise<LanguageModel> {
  if ("provider" in options) {
    if (options.provider === "openai") {
      return import("@ai-sdk/openai").then(({ createOpenAI }) =>
        createOpenAI({ apiKey: options.apiKey })(options.model),
      );
    }
    return import("@ai-sdk/anthropic").then(({ createAnthropic }) =>
      createAnthropic({ apiKey: options.apiKey })(options.model),
    );
  }

  return options.model;
}

export function visionRecoveryFallback(
  options: VisionRecoveryFallbackOptions,
): PageFallback {
  return async ({ page }): Promise<RecoveryAgentResult> => {
    const model = await resolveVisionRecoveryModel(options);
    return executeRecoveryAgent(
      page,
      options.instruction,
      undefined,
      model,
      options.maxSteps,
    );
  };
}

export function popupRecoveryFallback(
  options: PopupRecoveryFallbackOptions,
): PageFallback {
  return visionRecoveryFallback({
    ...options,
    instruction: POPUP_RECOVERY_INSTRUCTION,
  });
}
