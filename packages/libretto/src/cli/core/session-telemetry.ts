import type { BrowserContext, Page } from "playwright";

type TelemetryEntry = Record<string, unknown>;

type InstallSessionTelemetryOptions = {
  context: BrowserContext;
  initialPage: Page;
  logAction: (entry: TelemetryEntry) => void;
  logNetwork: (entry: TelemetryEntry) => void;
  includeUserDomActions?: boolean;
};

export async function installSessionTelemetry(
  options: InstallSessionTelemetryOptions,
): Promise<void> {
  const STATIC_EXT_RE = /\.(css|js|png|jpg|jpeg|gif|woff|woff2|ttf|ico|svg)(\?|$)/i;
  const { context, initialPage, logAction, logNetwork } = options;
  const includeUserDomActions = options.includeUserDomActions ?? false;
  const pageIdCache = new WeakMap<Page, string>();
  const wrappedPages = new WeakSet<Page>();
  const exposedPages = new WeakSet<Page>();

  const resolvePageId = async (page: Page): Promise<string> => {
    if (pageIdCache.has(page)) return pageIdCache.get(page)!;
    const cdpSession = await context.newCDPSession(page);
    try {
      const targetInfo = await cdpSession.send("Target.getTargetInfo");
      const targetId = (targetInfo as { targetInfo?: { targetId?: unknown } })?.targetInfo
        ?.targetId;
      if (typeof targetId !== "string" || targetId.length === 0) {
        throw new Error(`Could not resolve target id for page at URL "${page.url()}".`);
      }
      pageIdCache.set(page, targetId);
      return targetId;
    } finally {
      await cdpSession.detach();
    }
  };

  const emitAction = (entry: TelemetryEntry): void => {
    logAction({
      ts: new Date().toISOString(),
      ...entry,
    });
  };

  const emitNetwork = (entry: TelemetryEntry): void => {
    logNetwork({
      ts: new Date().toISOString(),
      ...entry,
    });
  };

  const markApiActionInProgress = async (page: Page, inProgress: boolean): Promise<void> => {
    await page.evaluate((flag) => {
      (window as any).__btApiActionInProgress = flag;
    }, inProgress);
  };

  const wrapLocator = (locator: any, page: Page, pageId: string): any => {
    if (locator.__librettoActionLogged) return locator;
    locator.__librettoActionLogged = true;

    const locatorActionMethods = [
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
    const locatorReturningMethods = [
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

    for (const actMethod of locatorActionMethods) {
      if (typeof locator[actMethod] !== "function") continue;
      const originalAction = locator[actMethod].bind(locator);
      locator[actMethod] = async (...actionArgs: any[]) => {
        const start = Date.now();
        await markApiActionInProgress(page, true);
        try {
          const result = await originalAction(...actionArgs);
          emitAction({
            pageId,
            action: actMethod,
            source: "agent",
            selector: "locator",
            value:
              actionArgs[0] !== undefined
                ? String(actionArgs[0]).slice(0, 100)
                : undefined,
            duration: Date.now() - start,
            success: true,
          });
          return result;
        } catch (error: any) {
          emitAction({
            pageId,
            action: actMethod,
            source: "agent",
            selector: "locator",
            duration: Date.now() - start,
            success: false,
            error: error?.message ?? String(error),
          });
          throw error;
        } finally {
          await markApiActionInProgress(page, false);
        }
      };
    }

    for (const method of locatorReturningMethods) {
      if (typeof locator[method] !== "function") continue;
      const originalMethod = locator[method].bind(locator);
      locator[method] = (...args: any[]) => {
        const child = originalMethod(...args);
        return wrapLocator(child, page, pageId);
      };
    }

    if (typeof locator.nth === "function") {
      const originalNth = locator.nth.bind(locator);
      locator.nth = (index: number) => {
        const child = originalNth(index);
        return wrapLocator(child, page, pageId);
      };
    }

    if (typeof locator.all === "function") {
      const originalAll = locator.all.bind(locator);
      locator.all = async () => {
        const items: any[] = await originalAll();
        return items.map((item: any) => wrapLocator(item, page, pageId));
      };
    }

    return locator;
  };

  const installUserDomTracking = async (page: Page, pageId: string): Promise<void> => {
    if (exposedPages.has(page)) return;
    exposedPages.add(page);

    await page.exposeFunction("__btActionLog", (jsonStr: string) => {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      emitAction({
        pageId,
        source: "user",
        ...parsed,
      });
    });

    await page.addInitScript(() => {
      if ((window as any).__btDomListenersInstalled) return;
      (window as any).__btDomListenersInstalled = true;

      const identify = (el: any): string => {
        if (!el || !el.tagName) return "";
        const testId = el.getAttribute("data-testid");
        if (testId) return `[data-testid="${testId}"]`;
        const role = el.getAttribute("role") || "";
        const id = el.id;
        if (role && id) return `${role}#${id}`;
        const label =
          el.getAttribute("aria-label") ||
          (el.textContent || "").trim().slice(0, 30) ||
          "";
        if (role && label) return `${role} "${label}"`;
        const tag = el.tagName.toLowerCase();
        const cls =
          el.className && typeof el.className === "string"
            ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
            : "";
        return `${tag}${cls}`;
      };

      let clickTimer: ReturnType<typeof setTimeout> | null = null;
      let pendingClick: { selector: string } | null = null;

      document.addEventListener(
        "click",
        (event) => {
          if ((window as any).__btApiActionInProgress) return;
          const target = event.target as any;
          const selector = identify(target);
          if (target?.type === "checkbox") {
            (window as any).__btActionLog(
              JSON.stringify({
                action: target.checked ? "check" : "uncheck",
                selector,
                success: true,
              }),
            );
            return;
          }
          pendingClick = { selector };
          if (clickTimer) clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
            if (pendingClick) {
              (window as any).__btActionLog(
                JSON.stringify({
                  action: "click",
                  selector: pendingClick.selector,
                  success: true,
                }),
              );
            }
            pendingClick = null;
            clickTimer = null;
          }, 200);
        },
        true,
      );

      document.addEventListener(
        "dblclick",
        (event) => {
          if ((window as any).__btApiActionInProgress) return;
          if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
            pendingClick = null;
          }
          const selector = identify(event.target);
          (window as any).__btActionLog(
            JSON.stringify({ action: "dblclick", selector, success: true }),
          );
        },
        true,
      );

      const inputTimers = new WeakMap<any, ReturnType<typeof setTimeout>>();
      document.addEventListener(
        "input",
        (event) => {
          if ((window as any).__btApiActionInProgress) return;
          const target = event.target as any;
          const selector = identify(target);
          if (target.tagName === "SELECT") {
            (window as any).__btActionLog(
              JSON.stringify({
                action: "selectOption",
                selector,
                value: target.value,
                success: true,
              }),
            );
            return;
          }
          const existing = inputTimers.get(target);
          if (existing) clearTimeout(existing);
          inputTimers.set(
            target,
            setTimeout(() => {
              inputTimers.delete(target);
              (window as any).__btActionLog(
                JSON.stringify({
                  action: "fill",
                  selector,
                  value: (target.value || "").slice(0, 100),
                  success: true,
                }),
              );
            }, 500),
          );
        },
        true,
      );

      const specialKeys = new Set([
        "Enter",
        "Escape",
        "Tab",
        "Backspace",
        "Delete",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "F1",
        "F2",
        "F3",
        "F4",
        "F5",
        "F6",
        "F7",
        "F8",
        "F9",
        "F10",
        "F11",
        "F12",
      ]);
      document.addEventListener(
        "keydown",
        (event) => {
          if ((window as any).__btApiActionInProgress) return;
          const isShortcut = event.ctrlKey || event.metaKey || event.altKey;
          if (!isShortcut && !specialKeys.has(event.key)) return;
          const selector = identify(event.target);
          const keyDesc =
            (event.ctrlKey ? "Ctrl+" : "") +
            (event.metaKey ? "Meta+" : "") +
            (event.altKey ? "Alt+" : "") +
            (event.shiftKey ? "Shift+" : "") +
            event.key;
          (window as any).__btActionLog(
            JSON.stringify({
              action: "press",
              selector,
              value: keyDesc,
              success: true,
            }),
          );
        },
        true,
      );

      let scrollTimer: ReturnType<typeof setTimeout> | null = null;
      document.addEventListener(
        "scroll",
        () => {
          if ((window as any).__btApiActionInProgress) return;
          if (scrollTimer) clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => {
            scrollTimer = null;
            (window as any).__btActionLog(
              JSON.stringify({
                action: "scroll",
                selector: "document",
                value: `y=${window.scrollY}`,
                success: true,
              }),
            );
          }, 300);
        },
        true,
      );
    });
  };

  const wrapPageActions = (page: Page, pageId: string): void => {
    if (wrappedPages.has(page)) return;
    wrappedPages.add(page);

    const pageActions = [
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
    const navActions = ["goto", "reload", "goBack", "goForward"] as const;
    const locatorFactories = [
      "locator",
      "getByRole",
      "getByText",
      "getByLabel",
      "getByPlaceholder",
      "getByAltText",
      "getByTitle",
      "getByTestId",
    ] as const;

    for (const method of pageActions) {
      const originalMethod = (page as any)[method].bind(page);
      (page as any)[method] = async (...args: any[]) => {
        const start = Date.now();
        await markApiActionInProgress(page, true);
        try {
          const result = await originalMethod(...args);
          emitAction({
            pageId,
            action: method,
            source: "agent",
            selector: typeof args[0] === "string" ? args[0] : undefined,
            value: args[1] !== undefined ? String(args[1]).slice(0, 100) : undefined,
            duration: Date.now() - start,
            success: true,
          });
          return result;
        } catch (error: any) {
          emitAction({
            pageId,
            action: method,
            source: "agent",
            selector: typeof args[0] === "string" ? args[0] : undefined,
            duration: Date.now() - start,
            success: false,
            error: error?.message ?? String(error),
          });
          throw error;
        } finally {
          await markApiActionInProgress(page, false);
        }
      };
    }

    for (const method of navActions) {
      const originalMethod = (page as any)[method].bind(page);
      (page as any)[method] = async (...args: any[]) => {
        const start = Date.now();
        try {
          const result = await originalMethod(...args);
          emitAction({
            pageId,
            action: method,
            source: "agent",
            url: typeof args[0] === "string" ? args[0] : page.url(),
            duration: Date.now() - start,
            success: true,
          });
          return result;
        } catch (error: any) {
          emitAction({
            pageId,
            action: method,
            source: "agent",
            url: typeof args[0] === "string" ? args[0] : undefined,
            duration: Date.now() - start,
            success: false,
            error: error?.message ?? String(error),
          });
          throw error;
        }
      };
    }

    for (const factory of locatorFactories) {
      const originalFactory = (page as any)[factory].bind(page);
      (page as any)[factory] = (...factoryArgs: any[]) => {
        const locator = originalFactory(...factoryArgs);
        return wrapLocator(locator, page, pageId);
      };
    }
  };

  const installForPage = async (page: Page): Promise<void> => {
    const pageId = await resolvePageId(page);
    wrapPageActions(page, pageId);

    if (includeUserDomActions) {
      await installUserDomTracking(page, pageId);
    }

    page.on("response", async (response) => {
      const request = response.request();
      const url = request.url();
      if (STATIC_EXT_RE.test(url) || url.startsWith("chrome-extension://")) return;
      emitNetwork({
        pageId,
        method: request.method(),
        url,
        status: response.status(),
        contentType: response.headers()["content-type"] ?? null,
        postData:
          request.method() === "POST" ||
          request.method() === "PUT" ||
          request.method() === "PATCH"
            ? (request.postData() ?? "").substring(0, 2000)
            : undefined,
        responseBody: null,
        size: null,
        durationMs: null,
      });
    });

    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      emitAction({
        pageId,
        action: "navigate",
        source: "agent",
        url: frame.url(),
        success: true,
      });
    });
    page.on("popup", (popup) => {
      emitAction({
        pageId,
        action: "popup",
        source: "agent",
        url: popup.url(),
        success: true,
      });
    });
    page.on("dialog", (dialog) => {
      emitAction({
        pageId,
        action: "dialog",
        source: "agent",
        value: `${dialog.type()}: ${dialog.message().slice(0, 500)}`,
        success: true,
      });
    });
  };

  await installForPage(initialPage);
  context.on("page", (newPage) => {
    void installForPage(newPage);
  });
}
