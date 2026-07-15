import type { Page } from "playwright";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MUTATION_IDLE_MS = 400;
const DEFAULT_MINIMUM_WAIT_MS = 800;
const DEFAULT_POLL_INTERVAL_MS = 100;

type LoadState = "domcontentloaded" | "load";

export type PageStabilityWaitOptions = {
  timeoutMs?: number;
  mutationIdleMs?: number;
  minimumWaitMs?: number;
  pollIntervalMs?: number;
};

export type PageStabilityWaitResult = {
  ok: boolean;
  diagnostics: string[];
};

type PageStabilityWaitArgs = Required<PageStabilityWaitOptions>;

type BrowserWaiterApi = {
  waitForStability(args: PageStabilityWaitArgs): Promise<string | null>;
};

export async function preparePageStabilityWait(
  page: Page,
  options: Pick<PageStabilityWaitOptions, "timeoutMs"> = {},
): Promise<PageStabilityWaitResult> {
  const diagnostic = await installBrowserStabilityWaiterOnPage(
    page,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  return {
    ok: diagnostic === null,
    diagnostics: diagnostic === null ? [] : [diagnostic],
  };
}

export async function waitForPageStable(
  page: Page,
  options: PageStabilityWaitOptions = {},
): Promise<PageStabilityWaitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const mutationIdleMs = options.mutationIdleMs ?? DEFAULT_MUTATION_IDLE_MS;
  const minimumWaitMs = options.minimumWaitMs ?? DEFAULT_MINIMUM_WAIT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  const loadDiagnostics = await Promise.all([
    waitForLoadState(page, "domcontentloaded", deadline),
    waitForLoadState(page, "load", deadline),
  ]);
  const browserDiagnostic = await waitForBrowserStability(page, {
    timeoutMs: Math.max(0, deadline - Date.now()),
    mutationIdleMs,
    minimumWaitMs,
    pollIntervalMs,
  });

  const diagnostics = [...loadDiagnostics, browserDiagnostic].filter(
    (diagnostic): diagnostic is string => diagnostic !== null,
  );

  return { ok: diagnostics.length === 0, diagnostics };
}

async function waitForLoadState(
  page: Page,
  state: LoadState,
  deadline: number,
): Promise<string | null> {
  const timeout = Math.max(0, deadline - Date.now());
  if (timeout === 0) return `Timed out waiting for ${state}`;

  try {
    await page.waitForLoadState(state, { timeout });
    return null;
  } catch (error) {
    return `Failed to wait for ${state}: ${errorMessage(error)}`;
  }
}

async function waitForBrowserStability(
  page: Page,
  args: PageStabilityWaitArgs,
): Promise<string | null> {
  const deadline = Date.now() + args.timeoutMs;
  let lastError: string | null = null;

  while (Date.now() < deadline) {
    const installDiagnostic = await installBrowserStabilityWaiterOnPage(
      page,
      Math.max(0, deadline - Date.now()),
    );
    if (installDiagnostic) return installDiagnostic;

    try {
      return await page.evaluate(runBrowserStabilityWait, {
        ...args,
        timeoutMs: Math.max(0, deadline - Date.now()),
      });
    } catch (error) {
      lastError = errorMessage(error);
      if (!isRetryableExecutionContextError(lastError)) {
        return `Failed to wait for page stability: ${lastError}`;
      }
      await sleep(Math.min(100, Math.max(0, deadline - Date.now())));
    }
  }

  return lastError
    ? `Failed to wait for page stability: ${lastError}`
    : "Timed out waiting for page stability";
}

async function installBrowserStabilityWaiterOnPage(
  page: Page,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;

  while (Date.now() < deadline) {
    try {
      await page.evaluate(installPageStabilityWaiter);
      return null;
    } catch (error) {
      lastError = errorMessage(error);
      if (!isRetryableExecutionContextError(lastError)) {
        return `Failed to install page stability waiter: ${lastError}`;
      }
      await sleep(Math.min(100, Math.max(0, deadline - Date.now())));
    }
  }

  return lastError
    ? `Failed to install page stability waiter: ${lastError}`
    : "Timed out installing page stability waiter";
}

export function installPageStabilityWaiter(): void {
  const symbol = Symbol.for("libretto.pageStabilityWaiter");
  const windowWithWaiter = window as Window & {
    [symbol]?: BrowserWaiterApi;
  };
  if (windowWithWaiter[symbol]) return;

  type WaiterState = {
    pendingRequests: number;
    pendingUrls: Set<string>;
  };

  type ResourceSnapshot = {
    pendingResources: number;
    pendingResourceLabels: string[];
  };

  const state: WaiterState = {
    pendingRequests: 0,
    pendingUrls: new Set<string>(),
  };

  const requestStarted = (url: string): void => {
    state.pendingRequests += 1;
    state.pendingUrls.add(url);
  };

  const requestFinished = (url: string): void => {
    state.pendingRequests = Math.max(0, state.pendingRequests - 1);
    state.pendingUrls.delete(url);
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function trackedFetch(
      this: Window,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const url = requestUrl(input);
      requestStarted(url);
      return originalFetch.call(this, input, init).finally(() => {
        requestFinished(url);
      });
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const requestUrls = new WeakMap<XMLHttpRequest, string>();
  const startedRequests = new WeakSet<XMLHttpRequest>();

  XMLHttpRequest.prototype.open = function trackedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    requestUrls.set(this, String(url));
    return originalOpen.call(
      this,
      method,
      url,
      async ?? true,
      username,
      password,
    );
  };

  XMLHttpRequest.prototype.send = function trackedSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const url = requestUrls.get(this) ?? "XMLHttpRequest";
    requestStarted(url);
    startedRequests.add(this);

    const finish = (): void => {
      if (!startedRequests.has(this)) return;
      startedRequests.delete(this);
      requestFinished(url);
    };

    this.addEventListener("loadend", finish, { once: true });
    try {
      return originalSend.call(this, body);
    } catch (error) {
      finish();
      throw error;
    }
  };

  const waitForStability = async (
    args: PageStabilityWaitArgs,
  ): Promise<string | null> => {
    const sleepInPage = (ms: number): Promise<void> =>
      new Promise((resolve) => window.setTimeout(resolve, ms));

    const startedAt = Date.now();
    let lastActivityAt = Date.now();
    let lastResources: ResourceSnapshot = {
      pendingResources: 0,
      pendingResourceLabels: [],
    };
    let lastPendingRequests = state.pendingRequests;
    let lastPendingUrls = [...state.pendingUrls];

    const markActivity = (): void => {
      lastActivityAt = Date.now();
    };

    const observer = new MutationObserver(markActivity);
    const root = document.documentElement ?? document.body;
    if (root) {
      observer.observe(root, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    try {
      while (Date.now() - startedAt < args.timeoutMs) {
        lastResources = countPendingResourceElements();
        lastPendingRequests = state.pendingRequests;
        lastPendingUrls = [...state.pendingUrls];
        const pageLoaded = document.readyState === "complete";
        const mutationIdle = Date.now() - lastActivityAt >= args.mutationIdleMs;
        const waitedLongEnough = Date.now() - startedAt >= args.minimumWaitMs;
        const requestIdle = lastPendingRequests === 0;
        const resourceIdle = lastResources.pendingResources === 0;

        if (
          pageLoaded &&
          mutationIdle &&
          waitedLongEnough &&
          requestIdle &&
          resourceIdle
        ) {
          return null;
        }

        await sleepInPage(args.pollIntervalMs);
      }
    } finally {
      observer.disconnect();
    }

    return formatStabilityTimeout({
      timeoutMs: args.timeoutMs,
      readyState: document.readyState,
      pendingRequests: lastPendingRequests,
      pendingUrls: lastPendingUrls,
      pendingResources: lastResources.pendingResources,
      pendingResourceLabels: lastResources.pendingResourceLabels,
    });
  };

  Object.defineProperty(windowWithWaiter, symbol, {
    value: { waitForStability } satisfies BrowserWaiterApi,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  function countPendingResourceElements(): ResourceSnapshot {
    const elements = Array.from(
      document.querySelectorAll(
        'img,video,audio,embed,object,iframe[src],link[rel="stylesheet"][href]',
      ),
    );
    let pendingResources = 0;
    const pendingResourceLabels: string[] = [];

    const markPending = (element: Element): void => {
      pendingResources += 1;
      if (pendingResourceLabels.length < 5) {
        pendingResourceLabels.push(resourceLabel(element));
      }
    };

    for (const element of elements) {
      const tagName = element.tagName.toLowerCase();
      if (tagName === "img") {
        const image = element as HTMLImageElement;
        if (image.loading !== "lazy" && !image.complete) markPending(element);
        continue;
      }

      if (tagName === "video" || tagName === "audio") {
        const media = element as HTMLMediaElement;
        if (media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          markPending(element);
        }
        continue;
      }

      if (tagName === "iframe") {
        const iframe = element as HTMLIFrameElement;
        try {
          if (
            iframe.contentDocument &&
            iframe.contentDocument.readyState !== "complete"
          ) {
            markPending(element);
          }
        } catch {
          // Cross-origin iframes cannot be inspected; treat them as settled.
        }
        continue;
      }

      if (tagName === "link") {
        const link = element as HTMLLinkElement;
        if (!link.sheet) markPending(element);
      }
    }

    return { pendingResources, pendingResourceLabels };
  }

  function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  function resourceLabel(element: Element): string {
    const tagName = element.tagName.toLowerCase();
    const source =
      element.getAttribute("src") ?? element.getAttribute("href") ?? "";
    return source ? `${tagName}:${source}` : tagName;
  }

  function formatStabilityTimeout(args: {
    timeoutMs: number;
    readyState: DocumentReadyState;
    pendingRequests: number;
    pendingUrls: string[];
    pendingResources: number;
    pendingResourceLabels: string[];
  }): string {
    const urls = args.pendingUrls.slice(0, 5).join(", ");
    const resources = args.pendingResourceLabels.join(", ");
    return (
      `Timed out waiting for page stability after ${args.timeoutMs}ms ` +
      `(readyState=${args.readyState}, pendingRequests=${args.pendingRequests}` +
      `${urls ? `, pendingUrls=${urls}` : ""}, pendingResources=${args.pendingResources}` +
      `${resources ? `, pendingResourceLabels=${resources}` : ""})`
    );
  }
}

async function runBrowserStabilityWait(
  args: PageStabilityWaitArgs,
): Promise<string | null> {
  const symbol = Symbol.for("libretto.pageStabilityWaiter");
  const waiter = (
    window as unknown as Window & Record<symbol, BrowserWaiterApi | undefined>
  )[symbol];
  if (!waiter) return "Page stability waiter was not installed.";
  return waiter.waitForStability(args);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableExecutionContextError(message: string): boolean {
  return (
    message.includes("Execution context was destroyed") ||
    message.includes("Cannot find context with specified id") ||
    message.includes("Most likely the page has been closed")
  );
}
