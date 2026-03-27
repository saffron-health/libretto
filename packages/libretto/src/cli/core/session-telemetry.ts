import type { BrowserContext, Page } from "playwright";
import {
  filterSemanticClasses,
  INTERACTIVE_ROLE_NAMES,
  INTERACTIVE_TAG_NAMES,
  isObfuscatedClass,
  TEST_ATTRIBUTE_NAMES,
  TRUSTED_ATTRIBUTE_NAMES,
} from "../../shared/dom-semantics.js";

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
  const STATIC_EXT_RE =
    /\.(css|js|png|jpg|jpeg|gif|woff|woff2|ttf|ico|svg)(\?|$)/i;
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
      const targetId = (targetInfo as { targetInfo?: { targetId?: unknown } })
        ?.targetInfo?.targetId;
      if (typeof targetId !== "string" || targetId.length === 0) {
        throw new Error(
          `Could not resolve target id for page at URL "${page.url()}".`,
        );
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

  const markApiActionInProgress = async (
    page: Page,
    inProgress: boolean,
  ): Promise<void> => {
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

  const createUserDomTrackingInitScript = (): string => {
    const selectorAttributeNames = [
      "id",
      ...TEST_ATTRIBUTE_NAMES,
      "name",
      "for",
      "role",
      "aria-label",
      "title",
      "placeholder",
      "alt",
      "href",
      "type",
    ];

    return `
(() => {
  if (window.__btDomListenersInstalled) return;
  window.__btDomListenersInstalled = true;

  const TEST_ATTRS = new Set(${JSON.stringify([...TEST_ATTRIBUTE_NAMES])});
  const TRUSTED_ATTRS = new Set(${JSON.stringify([...TRUSTED_ATTRIBUTE_NAMES])});
  const INTERACTIVE_TAGS = new Set(${JSON.stringify([...INTERACTIVE_TAG_NAMES])});
  const INTERACTIVE_ROLES = new Set(${JSON.stringify([...INTERACTIVE_ROLE_NAMES])});
  const SELECTOR_ATTRS = ${JSON.stringify(selectorAttributeNames)};

  ${filterSemanticClasses.toString()}
  ${isObfuscatedClass.toString()}

  const normalizeWhitespace = (value) =>
    String(value || "").replace(/\\s+/g, " ").trim();

  const clipText = (value, limit = 120) => {
    const normalized = normalizeWhitespace(value);
    if (!normalized) return "";
    return normalized.length > limit
      ? \`\${normalized.slice(0, limit - 1)}…\`
      : normalized;
  };

  const cssEscape = (value) => {
    if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
      return globalThis.CSS.escape(String(value));
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => {
      const hex = char.charCodeAt(0).toString(16);
      return \`\\\\\${hex} \`;
    });
  };

  const quoteAttrValue = (value) =>
    String(value).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"');

  const isElementNode = (value) => value instanceof Element;

  const isInteractiveElement = (el) => {
    if (!el || !el.tagName) return false;
    const tagName = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tagName)) return true;
    if (el.hasAttribute("tabindex") || el.hasAttribute("contenteditable")) {
      return true;
    }
    const role = normalizeWhitespace(el.getAttribute("role")).toLowerCase();
    return Boolean(role) && INTERACTIVE_ROLES.has(role);
  };

  const getFilteredClassSelector = (el) => {
    const className =
      typeof el.className === "string"
        ? filterSemanticClasses(el.className)
        : "";
    const classes = className
      .split(/\\s+/)
      .filter(Boolean)
      .slice(0, 2);
    if (classes.length === 0) return "";
    return classes.map((cls) => \`.\${cssEscape(cls)}\`).join("");
  };

  const getMeaningfulAttrValue = (el, attrName) => {
    if (!el.hasAttribute(attrName)) return "";
    const value = clipText(el.getAttribute(attrName) || "", 80);
    if (!value) return "";
    if (attrName === "href" && value.startsWith("javascript:")) return "";
    return value;
  };

  const buildSelectorForElement = (el) => {
    if (!isElementNode(el)) return "";
    const tagName = el.tagName.toLowerCase();
    const id = clipText(el.id || "", 80);
    if (id) {
      return \`\${tagName}#\${cssEscape(id)}\`;
    }

    for (const attrName of SELECTOR_ATTRS) {
      if (attrName === "id") continue;
      const value = getMeaningfulAttrValue(el, attrName);
      if (!value) continue;
      if (attrName.startsWith("data-")) {
        return \`\${tagName}[\${attrName}="\${quoteAttrValue(value)}"]\`;
      }
      return \`\${tagName}[\${attrName}="\${quoteAttrValue(value)}"]\`;
    }

    const classSelector = getFilteredClassSelector(el);
    if (classSelector) {
      return \`\${tagName}\${classSelector}\`;
    }

    return tagName;
  };

  const getElementSummary = (el) => {
    if (!isElementNode(el)) return "";
    const selector = buildSelectorForElement(el);
    const role = clipText(el.getAttribute("role") || "", 40);
    const text = getElementText(el);
    const suffix = [];
    if (role) suffix.push(\`role=\${role}\`);
    if (text) suffix.push(\`text="\${text}"\`);
    return suffix.length > 0 ? \`\${selector} [\${suffix.join(", ")}]\` : selector;
  };

  const getElementText = (el) => {
    if (!isElementNode(el)) return "";
    const tagName = el.tagName.toLowerCase();
    if (tagName === "input") {
      const inputType = normalizeWhitespace(el.getAttribute("type")).toLowerCase();
      if (inputType === "password") return "";
      const value = clipText(el.value || el.getAttribute("value") || "", 80);
      if (value) return value;
    }

    const attrCandidates = [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("placeholder"),
      el.getAttribute("alt"),
      el.textContent,
    ];

    for (const candidate of attrCandidates) {
      const text = clipText(candidate || "", 120);
      if (text.length >= 2) return text;
    }

    return "";
  };

  const isMeaningfulAncestor = (el) => {
    if (!isElementNode(el)) return false;
    const tagName = el.tagName.toLowerCase();
    if (isInteractiveElement(el)) return true;
    if (
      [
        "tr",
        "li",
        "td",
        "th",
        "label",
        "section",
        "article",
        "dialog",
        "fieldset",
        "summary",
      ].includes(tagName)
    ) {
      return true;
    }
    if (el.id) return true;
    for (const attrName of TEST_ATTRS) {
      if (el.hasAttribute(attrName)) return true;
    }
    const role = normalizeWhitespace(el.getAttribute("role")).toLowerCase();
    return Boolean(role);
  };

  const hasStrongSelectorSignal = (el, selector) => {
    if (!isElementNode(el)) return false;
    if (!selector) return false;
    const tagName = el.tagName.toLowerCase();
    if (el.id) return true;
    if (isInteractiveElement(el)) return true;
    if (getFilteredClassSelector(el)) return true;
    for (const attrName of SELECTOR_ATTRS) {
      if (attrName === "id") continue;
      if (getMeaningfulAttrValue(el, attrName)) return true;
    }
    return selector !== tagName;
  };

  const getAncestorSelectors = (target) => {
    const selectors = [];
    let current = isElementNode(target) ? target : null;
    let depth = 0;
    while (current && depth < 7) {
      const selector = buildSelectorForElement(current);
      if (
        selector &&
        !selectors.includes(selector) &&
        (
          (depth === 0 && hasStrongSelectorSignal(current, selector)) ||
          isMeaningfulAncestor(current)
        )
      ) {
        selectors.push(selector);
      }
      current = current.parentElement;
      depth += 1;
    }
    if (selectors.length === 0 && isElementNode(target)) {
      selectors.push(buildSelectorForElement(target));
    }
    return selectors;
  };

  const getNearbyText = (target) => {
    let current = isElementNode(target) ? target : null;
    let depth = 0;
    while (current && depth < 6) {
      const text = getElementText(current);
      if (text.length >= 2) return text;
      current = current.parentElement;
      depth += 1;
    }
    return "";
  };

  const getComposedPathSummary = (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path
      .filter((entry) => isElementNode(entry))
      .slice(0, 6)
      .map((entry) => getElementSummary(entry));
  };

  const getCoordinates = (event) => {
    if (!(event instanceof MouseEvent)) return undefined;
    return {
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
    };
  };

  const buildActionPayload = (event, action, extra = {}) => {
    const target = isElementNode(event.target) ? event.target : null;
    const ancestorSelectors = getAncestorSelectors(target);
    const bestSemanticSelector = ancestorSelectors[0] || "";
    const targetSelector = target ? buildSelectorForElement(target) : "";
    return {
      action,
      bestSemanticSelector: bestSemanticSelector || undefined,
      targetSelector: targetSelector || undefined,
      ancestorSelectors: ancestorSelectors.length > 0 ? ancestorSelectors : undefined,
      nearbyText: getNearbyText(target) || undefined,
      composedPath: getComposedPathSummary(event),
      coordinates: getCoordinates(event),
      success: true,
      ...extra,
    };
  };

  let clickTimer = null;
  let pendingClick = null;

  document.addEventListener(
    "click",
    (event) => {
      if (window.__btApiActionInProgress) return;
      const target = isElementNode(event.target) ? event.target : null;
      if (target?.type === "checkbox") {
        window.__btActionLog(
          JSON.stringify(
            buildActionPayload(event, target.checked ? "check" : "uncheck"),
          ),
        );
        return;
      }

      pendingClick = buildActionPayload(event, "click");
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        if (pendingClick) {
          window.__btActionLog(JSON.stringify(pendingClick));
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
      if (window.__btApiActionInProgress) return;
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        pendingClick = null;
      }
      window.__btActionLog(
        JSON.stringify(buildActionPayload(event, "dblclick")),
      );
    },
    true,
  );

  const inputTimers = new WeakMap();
  document.addEventListener(
    "input",
    (event) => {
      if (window.__btApiActionInProgress) return;
      const target = isElementNode(event.target) ? event.target : null;
      if (!target) return;

      if (target.tagName === "SELECT") {
        window.__btActionLog(
          JSON.stringify(
            buildActionPayload(event, "selectOption", {
              value: target.value,
            }),
          ),
        );
        return;
      }

      const existing = inputTimers.get(target);
      if (existing) clearTimeout(existing);
      inputTimers.set(
        target,
        setTimeout(() => {
          inputTimers.delete(target);
          window.__btActionLog(
            JSON.stringify(
              buildActionPayload(event, "fill", {
                value: String(target.value || "").slice(0, 100),
              }),
            ),
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
      if (window.__btApiActionInProgress) return;
      const isShortcut = event.ctrlKey || event.metaKey || event.altKey;
      if (!isShortcut && !specialKeys.has(event.key)) return;
      const keyDesc =
        (event.ctrlKey ? "Ctrl+" : "") +
        (event.metaKey ? "Meta+" : "") +
        (event.altKey ? "Alt+" : "") +
        (event.shiftKey ? "Shift+" : "") +
        event.key;
      window.__btActionLog(
        JSON.stringify(
          buildActionPayload(event, "press", {
            value: keyDesc,
          }),
        ),
      );
    },
    true,
  );

  let scrollTimer = null;
  document.addEventListener(
    "scroll",
    () => {
      if (window.__btApiActionInProgress) return;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        window.__btActionLog(
          JSON.stringify({
            action: "scroll",
            bestSemanticSelector: "document",
            success: true,
            value: \`y=\${window.scrollY}\`,
          }),
        );
      }, 300);
    },
    true,
  );
})();
`;
  };

  const installUserDomTracking = async (
    page: Page,
    pageId: string,
  ): Promise<void> => {
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

    await page.addInitScript({ content: createUserDomTrackingInitScript() });
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
            value:
              args[1] !== undefined ? String(args[1]).slice(0, 100) : undefined,
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
      if (STATIC_EXT_RE.test(url) || url.startsWith("chrome-extension://"))
        return;
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
