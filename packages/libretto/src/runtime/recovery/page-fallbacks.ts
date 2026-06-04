import type { FrameLocator, Locator, Page } from "playwright";
import type { LanguageModel } from "ai";
import { executeRecoveryAgent, type RecoveryAgentResult } from "./agent.js";
import { defaultLogger } from "../../shared/logger/logger.js";

export type RecoveryActionTargetType = "page" | "locator";

export type RecoveryActionContext = {
  page: Page;
  targetType: RecoveryActionTargetType;
  method: string;
  args: readonly unknown[];
  error: unknown;
};

export type RecoveryActionResult = Record<string, unknown> | void;

export type RecoveryActionHandler = (
  context: RecoveryActionContext,
) => Promise<RecoveryActionResult>;

export type RecoveryAction = RecoveryActionHandler;

export type RecoveryActionOptions = {
  recoveryAction: RecoveryAction;
};

type ComputerUseRecoveryModelOptions =
  | {
      languageModel: LanguageModel;
    }
  | {
      provider: "openai";
      apiKey: string;
      model?: "gpt-5.5";
    }
  | {
      provider: "anthropic";
      apiKey: string;
      model?: "claude-sonnet-4-6";
    };

export type ComputerUseRecoveryActionOptions = ComputerUseRecoveryModelOptions & {
  instruction: string;
  maxSteps?: number;
};

export type PopupRecoveryActionOptions = ComputerUseRecoveryModelOptions & {
  maxSteps?: number;
};

export const POPUP_RECOVERY_INSTRUCTION = [
  "Look at the page for any popup, modal, cookie banner, overlay, dialog, or interstitial that blocks interaction.",
  "If any blocking popup is visible, close it before returning done.",
  "Prefer obvious close, dismiss, continue, accept, or X buttons.",
  "Do not return done while a blocking overlay or dialog is still visible.",
].join(" ");

export const COMPUTER_USE_RECOVERY_MODELS = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.5",
} as const;

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

function isUiMethod(
  targetType: RecoveryActionTargetType,
  method: string,
): boolean {
  return targetType === "page"
    ? PAGE_UI_METHODS.has(method)
    : LOCATOR_UI_METHODS.has(method);
}

function isReadMethod(
  targetType: RecoveryActionTargetType,
  method: string,
): boolean {
  return targetType === "page"
    ? PAGE_READ_METHODS.has(method)
    : LOCATOR_READ_METHODS.has(method);
}

function isSupportedMethod(
  targetType: RecoveryActionTargetType,
  method: string,
): boolean {
  return isUiMethod(targetType, method) || isReadMethod(targetType, method);
}

async function runWithFallback<T>(args: {
  page: Page;
  targetType: RecoveryActionTargetType;
  method: string;
  methodArgs: readonly unknown[];
  invoke: () => T | Promise<T>;
  options: RecoveryActionOptions;
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

    defaultLogger.info("Action failed, attempting recovery", {
      targetType: baseContext.targetType,
      method: baseContext.method,
      argsCount: baseContext.args.length,
      error: formatErrorForLog(originalError),
    });

    let recoveryResult: RecoveryActionResult;
    try {
      recoveryResult = await args.options.recoveryAction({
        ...baseContext,
        error: originalError,
      });
    } catch (recoveryError) {
      defaultLogger.warn("Recovery action failed", {
        targetType: baseContext.targetType,
        method: baseContext.method,
        originalError: formatErrorForLog(originalError),
        recoveryError: formatErrorForLog(recoveryError),
      });
      throw originalError;
    }

    defaultLogger.info("Recovery action completed, retrying original action", {
      targetType: baseContext.targetType,
      method: baseContext.method,
      recoveryResult,
    });

    try {
      const result = await args.invoke();
      defaultLogger.info("Recovered action retry succeeded", {
        targetType: baseContext.targetType,
        method: baseContext.method,
      });
      return result;
    } catch (retryError) {
      defaultLogger.warn("Recovered action retry failed", {
        targetType: baseContext.targetType,
        method: baseContext.method,
        originalError: formatErrorForLog(originalError),
        retryError: formatErrorForLog(retryError),
      });
      throw originalError;
    }
  }
}

function formatErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { value: String(error) };
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
  options: RecoveryActionOptions,
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
  options: RecoveryActionOptions,
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
  options: RecoveryActionOptions,
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

export function createRecoveryPage(
  page: Page,
  options: RecoveryActionOptions,
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

async function resolveComputerUseRecoveryModel(
  options: ComputerUseRecoveryActionOptions,
): Promise<LanguageModel> {
  if ("provider" in options) {
    if (options.provider === "openai") {
      const model: string = options.model ?? COMPUTER_USE_RECOVERY_MODELS.openai;
      if (model !== COMPUTER_USE_RECOVERY_MODELS.openai) {
        throw new Error(
          `Unsupported OpenAI computer use recovery model "${model}". Supported model: ${COMPUTER_USE_RECOVERY_MODELS.openai}.`,
        );
      }
      return import("@ai-sdk/openai").then(({ createOpenAI }) =>
        createOpenAI({ apiKey: options.apiKey })(model),
      );
    }
    const model: string =
      options.model ?? COMPUTER_USE_RECOVERY_MODELS.anthropic;
    if (model !== COMPUTER_USE_RECOVERY_MODELS.anthropic) {
      throw new Error(
        `Unsupported Anthropic computer use recovery model "${model}". Supported model: ${COMPUTER_USE_RECOVERY_MODELS.anthropic}.`,
      );
    }
    return import("@ai-sdk/anthropic").then(({ createAnthropic }) =>
      createAnthropic({ apiKey: options.apiKey })(model),
    );
  }

  return options.languageModel;
}

export function computerUseRecoveryAction(
  options: ComputerUseRecoveryActionOptions,
): RecoveryAction {
  return async ({ page }): Promise<RecoveryAgentResult> => {
    const model = await resolveComputerUseRecoveryModel(options);
    return executeRecoveryAgent(
      page,
      options.instruction,
      undefined,
      model,
      options.maxSteps,
    );
  };
}

export function popupRecoveryAction(
  options: PopupRecoveryActionOptions,
): RecoveryAction {
  return computerUseRecoveryAction({
    ...options,
    instruction: POPUP_RECOVERY_INSTRUCTION,
  });
}
