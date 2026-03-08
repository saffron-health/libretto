import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { openSync, existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import {
  getLog,
  getSessionActionsLogPath,
  getSessionNetworkLogPath,
  PROFILES_DIR,
  REPO_ROOT,
  setLogFile,
} from "./context.js";
import {
  assertSessionAvailableForStart,
  clearSessionState,
  generateRunId,
  getSessionPermissionMode,
  readSessionStateOrThrow,
  logFileForSession,
  readSessionState,
  writeSessionState,
} from "./session.js";

async function pickFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to pick free port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

export function normalizeUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) {
    return `https://${url}`;
  }
  return url;
}

export function normalizeDomain(url: string): string {
  try {
    const u = new URL(normalizeUrl(url));
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^www\./, "");
  }
}

export function getProfilePath(domain: string): string {
  return join(PROFILES_DIR, `${domain}.json`);
}

export function hasProfile(domain: string): boolean {
  return existsSync(getProfilePath(domain));
}

async function tryConnectToPort(
  port: number,
  timeoutMs: number = 5000,
): Promise<Browser | null> {
  const log = getLog();
  const endpoint = `http://localhost:${port}`;
  log.info("cdp-connect-attempt", { port, endpoint, timeoutMs });
  try {
    const connectPromise = chromium.connectOverCDP(endpoint);
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs),
    );
    const browser = await Promise.race([connectPromise, timeoutPromise]);
    if (browser) {
      log.info("cdp-connect-success", {
        port,
        endpoint,
        contexts: browser.contexts().length,
      });
    } else {
      log.warn("cdp-connect-timeout", { port, endpoint, timeoutMs });
    }
    return browser;
  } catch (err) {
    log.error("cdp-connect-error", { error: err, port, endpoint });
    return null;
  }
}

export function disconnectBrowser(browser: Browser, session?: string): void {
  const log = getLog();
  log.info("cdp-disconnect", { session });
  try {
    (browser as any)._connection?.close();
  } catch (err) {
    log.warn("cdp-disconnect-already-closed", { error: err });
  }
}

export async function connect(
  session: string,
  timeoutMs: number = 10000,
): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const log = getLog();
  log.info("connect", { session, timeoutMs });
  const state = readSessionStateOrThrow(session);
  const browser = await tryConnectToPort(state.port, timeoutMs);
  if (!browser) {
    log.error("connect-no-browser", {
      session,
      port: state.port,
      pid: state.pid,
    });
    clearSessionState(session);
    throw new Error(
      `No browser running for session "${session}". Run 'libretto-cli open <url> --session ${session}' first.`,
    );
  }

  const contexts = browser.contexts();
  log.info("connect-contexts", { session, contextCount: contexts.length });
  if (contexts.length === 0) {
    log.error("connect-no-contexts", { session });
    throw new Error("No browser context found.");
  }

  const allPages = contexts.flatMap((c) => c.pages());
  const pages = allPages.filter((p) => {
    const url = p.url();
    return !url.startsWith("devtools://") && !url.startsWith("chrome-error://");
  });

  log.info("connect-pages", {
    session,
    totalPages: allPages.length,
    filteredPages: pages.length,
    urls: allPages.map((p) => p.url()),
  });

  if (pages.length === 0) {
    log.error("connect-no-pages", {
      session,
      allPageUrls: allPages.map((p) => p.url()),
    });
    throw new Error("No pages found.");
  }

  const page = pages[pages.length - 1]!;
  const context = page.context();

  page.on("close", () => {
    log.error("page-closed-during-command", {
      session,
      url: page.url(),
      trace: new Error("page-closed-trace").stack,
    });
  });
  page.on("crash", () => {
    log.error("page-crashed-during-command", {
      session,
      url: page.url(),
    });
  });
  browser.on("disconnected", () => {
    log.error("browser-disconnected-during-command", {
      session,
      trace: new Error("browser-disconnected-trace").stack,
    });
  });

  log.info("connect-success", { session, pageUrl: page.url() });
  return { browser, context, page };
}

export async function runOpen(
  rawUrl: string,
  headed: boolean,
  session: string,
): Promise<void> {
  let log = getLog();
  const sessionMode = getSessionPermissionMode(session);
  const url = normalizeUrl(rawUrl);
  log.info("open-start", { url, headed, session, sessionMode });
  assertSessionAvailableForStart(session);

  const port = await pickFreePort();
  const runId = generateRunId();
  const runLogPath = logFileForSession(session);
  const networkLogPath = getSessionNetworkLogPath(session);
  const actionsLogPath = getSessionActionsLogPath(session);

  setLogFile(runLogPath);
  log = getLog();

  const browserMode = headed ? "headed" : "headless";
  const domain = normalizeDomain(url);
  const profilePath = getProfilePath(domain);
  const useProfile = hasProfile(domain);

  log.info("open-launching", {
    url,
    mode: browserMode,
    sessionMode,
    session,
    port,
    runId,
    domain,
    useProfile,
    profilePath: useProfile ? profilePath : undefined,
  });

  if (useProfile) {
    console.log(`Loading saved profile for ${domain}`);
  }
  console.log(
    `Launching ${browserMode} browser (session: ${session}, run: ${runId})...`,
  );

  const escapedProfilePath = profilePath
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
  const escapedUrl = url.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const storageStateCode = useProfile
    ? `storageState: '${escapedProfilePath}',`
    : "";

  const escapedLogPath = runLogPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const escapedNetworkLogPath = networkLogPath
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
  const escapedActionsLogPath = actionsLogPath
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");

  const launcherCode = `
import { chromium } from 'playwright';
import { appendFileSync, mkdirSync } from 'node:fs';

const LOG_FILE = '${escapedLogPath}';
const NETWORK_LOG = '${escapedNetworkLogPath}';
const ACTIONS_LOG = '${escapedActionsLogPath}';
mkdirSync(NETWORK_LOG.replace(/\\/[^\\/]+$/, ''), { recursive: true });

const STATIC_EXT_RE = /\\.(css|js|png|jpg|jpeg|gif|woff|woff2|ttf|ico|svg)(\\?|$)/i;
async function logNetworkResponse(response) {
	try {
		const req = response.request();
		const url = req.url();
		if (STATIC_EXT_RE.test(url) || url.startsWith('chrome-extension://')) return;
		let responseBody = null;
		try {
			const buf = await response.body();
			responseBody = buf.toString('utf-8');
		} catch {}
		const entry = JSON.stringify({
			ts: new Date().toISOString(),
			method: req.method(),
			url,
			status: response.status(),
			contentType: response.headers()['content-type'] || null,
			postData: req.method() === 'POST' || req.method() === 'PUT' || req.method() === 'PATCH'
				? (req.postData() || '').substring(0, 2000)
				: undefined,
			responseBody,
		});
		appendFileSync(NETWORK_LOG, entry + '\\n');
	} catch {}
}

function logAction(entry) {
	try {
		const record = { ts: new Date().toISOString(), ...entry };
		appendFileSync(ACTIONS_LOG, JSON.stringify(record) + '\\n');
	} catch {}
}

function childLog(level, event, data = {}) {
	try {
		const entry = JSON.stringify({
			timestamp: new Date().toISOString(),
			id: Math.random().toString(36).slice(2, 10),
			level,
			scope: 'libretto-cli.child',
			event,
			data,
		});
		appendFileSync(LOG_FILE, entry + '\\n');
	} catch {}
}

async function setupActionTracking(p) {
	await p.exposeFunction('__btActionLog', (jsonStr) => {
		try { logAction({ ...JSON.parse(jsonStr), source: 'user' }); } catch {}
	});

	await p.addInitScript(() => {
		if (window.__btDomListenersInstalled) return;
		window.__btDomListenersInstalled = true;

		function identify(el) {
			if (!el || !el.tagName) return '';
			var tid = el.getAttribute('data-testid');
			if (tid) return '[data-testid="' + tid + '"]';
			var role = el.getAttribute('role') || '';
			var id = el.id;
			if (role && id) return role + '#' + id;
			var name = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30) || '';
			if (role && name) return role + ' "' + name + '"';
			var tag = el.tagName.toLowerCase();
			var cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
			return tag + cls;
		}

		var clickTimer = null;
		var pendingClick = null;

		document.addEventListener('click', function(e) {
			if (window.__btApiActionInProgress) return;
			var target = e.target;
			var sel = identify(target);
			if (target.type === 'checkbox') {
				if (typeof window.__btActionLog === 'function') {
					window.__btActionLog(JSON.stringify({ action: target.checked ? 'check' : 'uncheck', selector: sel, success: true }));
				}
				return;
			}
			pendingClick = { selector: sel };
			if (clickTimer) clearTimeout(clickTimer);
			clickTimer = setTimeout(function() {
				if (pendingClick && typeof window.__btActionLog === 'function') {
					window.__btActionLog(JSON.stringify({ action: 'click', selector: pendingClick.selector, success: true }));
				}
				pendingClick = null;
				clickTimer = null;
			}, 200);
		}, true);

		document.addEventListener('dblclick', function(e) {
			if (window.__btApiActionInProgress) return;
			if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; pendingClick = null; }
			var sel = identify(e.target);
			if (typeof window.__btActionLog === 'function') {
				window.__btActionLog(JSON.stringify({ action: 'dblclick', selector: sel, success: true }));
			}
		}, true);

		var inputTimers = new WeakMap();
		document.addEventListener('input', function(e) {
			if (window.__btApiActionInProgress) return;
			var target = e.target;
			var sel = identify(target);
			if (target.tagName === 'SELECT') {
				if (typeof window.__btActionLog === 'function') {
					window.__btActionLog(JSON.stringify({ action: 'selectOption', selector: sel, value: target.value, success: true }));
				}
				return;
			}
			var existing = inputTimers.get(target);
			if (existing) clearTimeout(existing);
			inputTimers.set(target, setTimeout(function() {
				inputTimers.delete(target);
				if (typeof window.__btActionLog === 'function') {
					window.__btActionLog(JSON.stringify({ action: 'fill', selector: sel, value: (target.value || '').slice(0, 100), success: true }));
				}
			}, 500));
		}, true);

		var SPECIAL_KEYS = ['Enter','Escape','Tab','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'];
		document.addEventListener('keydown', function(e) {
			if (window.__btApiActionInProgress) return;
			var isShortcut = e.ctrlKey || e.metaKey || e.altKey;
			if (!isShortcut && SPECIAL_KEYS.indexOf(e.key) === -1) return;
			var sel = identify(e.target);
			var keyDesc = (e.ctrlKey ? 'Ctrl+' : '') + (e.metaKey ? 'Meta+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + e.key;
			if (typeof window.__btActionLog === 'function') {
				window.__btActionLog(JSON.stringify({ action: 'press', selector: sel, value: keyDesc, success: true }));
			}
		}, true);

		var scrollTimer = null;
		document.addEventListener('scroll', function() {
			if (window.__btApiActionInProgress) return;
			if (scrollTimer) clearTimeout(scrollTimer);
			scrollTimer = setTimeout(function() {
				scrollTimer = null;
				if (typeof window.__btActionLog === 'function') {
					window.__btActionLog(JSON.stringify({ action: 'scroll', selector: 'document', value: 'y=' + window.scrollY, success: true }));
				}
			}, 300);
		}, true);
	});

	var PAGE_ACTIONS = ['click', 'dblclick', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'hover', 'focus'];
	var NAV_ACTIONS = ['goto', 'reload', 'goBack', 'goForward'];

	for (var m of PAGE_ACTIONS) {
		(function(method) {
			var orig = p[method].bind(p);
			p[method] = async function() {
				var args = Array.from(arguments);
				var start = Date.now();
				try { await p.evaluate(function() { window.__btApiActionInProgress = true; }); } catch {}
				try {
					var result = await orig.apply(null, args);
					logAction({ action: method, source: 'agent', selector: typeof args[0] === 'string' ? args[0] : undefined, value: args[1] !== undefined ? String(args[1]).slice(0, 100) : undefined, duration: Date.now() - start, success: true });
					return result;
				} catch (err) {
					logAction({ action: method, source: 'agent', selector: typeof args[0] === 'string' ? args[0] : undefined, duration: Date.now() - start, success: false, error: err.message });
					throw err;
				} finally {
					try { await p.evaluate(function() { window.__btApiActionInProgress = false; }); } catch {}
				}
			};
		})(m);
	}

	for (var m of NAV_ACTIONS) {
		(function(method) {
			var orig = p[method].bind(p);
			p[method] = async function() {
				var args = Array.from(arguments);
				var start = Date.now();
				try {
					var result = await orig.apply(null, args);
					logAction({ action: method, source: 'agent', url: typeof args[0] === 'string' ? args[0] : p.url(), duration: Date.now() - start, success: true });
					return result;
				} catch (err) {
					logAction({ action: method, source: 'agent', url: typeof args[0] === 'string' ? args[0] : undefined, duration: Date.now() - start, success: false, error: err.message });
					throw err;
				}
			};
		})(m);
	}

	var LOCATOR_FACTORIES = ['locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId'];
	for (var f of LOCATOR_FACTORIES) {
		(function(factory) {
			var orig = p[factory].bind(p);
			p[factory] = function() {
				var args = Array.from(arguments);
				var locator = orig.apply(null, args);
				var hint = factory + '(' + args.map(function(a) { return typeof a === 'string' ? a : JSON.stringify(a); }).join(', ') + ')';
				for (var am of PAGE_ACTIONS) {
					(function(actMethod) {
						if (typeof locator[actMethod] !== 'function') return;
						var origAct = locator[actMethod].bind(locator);
						locator[actMethod] = async function() {
							var actArgs = Array.from(arguments);
							var start = Date.now();
							try { await p.evaluate(function() { window.__btApiActionInProgress = true; }); } catch {}
							try {
								var result = await origAct.apply(null, actArgs);
								logAction({ action: actMethod, source: 'agent', selector: hint, value: actArgs[0] !== undefined ? String(actArgs[0]).slice(0, 100) : undefined, duration: Date.now() - start, success: true });
								return result;
							} catch (err) {
								logAction({ action: actMethod, source: 'agent', selector: hint, duration: Date.now() - start, success: false, error: err.message });
								throw err;
							} finally {
								try { await p.evaluate(function() { window.__btApiActionInProgress = false; }); } catch {}
							}
						};
					})(am);
				}
				return locator;
			};
		})(f);
	}
}

const browser = await chromium.launch({
	headless: ${!headed},
	args: ['--disable-blink-features=AutomationControlled', '--remote-debugging-port=${port}', '--remote-debugging-address=127.0.0.1', '--no-focus-on-check'],
});

browser.on('disconnected', () => {
	childLog('warn', 'browser-disconnected', { port: ${port} });
});

const context = await browser.newContext({
	${storageStateCode}
	viewport: { width: 1366, height: 768 },
	userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
});

const page = await context.newPage();
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(45000);

await setupActionTracking(page);

page.on('crash', () => childLog('error', 'page-crash', { url: page.url() }));
page.on('close', () => childLog('warn', 'page-close', { url: page.url(), trace: new Error('page-close-trace').stack }));
page.on('pageerror', (err) => childLog('error', 'page-error', { message: err.message, stack: err.stack }));
page.on('console', (msg) => {
	if (msg.type() === 'error' || msg.type() === 'warning') {
		childLog(msg.type() === 'error' ? 'error' : 'warn', 'console-' + msg.type(), { text: msg.text(), url: page.url() });
	}
});
page.on('framenavigated', (frame) => {
	if (frame === page.mainFrame()) {
		childLog('info', 'page-navigated', { url: frame.url() });
		logAction({ action: 'navigate', source: 'agent', url: frame.url(), success: true });
	}
});
page.on('requestfailed', (req) => {
	const failure = req.failure();
	childLog('warn', 'request-failed', { url: req.url(), method: req.method(), errorText: failure?.errorText });
});
page.on('response', logNetworkResponse);
page.on('popup', (popup) => logAction({ action: 'popup', source: 'agent', url: popup.url(), success: true }));
page.on('dialog', (dialog) => logAction({ action: 'dialog', source: 'agent', value: dialog.type() + ': ' + dialog.message().slice(0, 500), success: true }));

context.on('page', async (newPage) => {
	childLog('info', 'new-page-created', { url: newPage.url() });
	newPage.on('crash', () => childLog('error', 'page-crash', { url: newPage.url() }));
	newPage.on('close', () => childLog('info', 'page-close', { url: newPage.url(), trace: new Error('page-close-trace').stack }));
	newPage.on('response', logNetworkResponse);
	newPage.on('popup', (popup) => logAction({ action: 'popup', source: 'agent', url: popup.url(), success: true }));
	newPage.on('dialog', (dialog) => logAction({ action: 'dialog', source: 'agent', value: dialog.type() + ': ' + dialog.message().slice(0, 500), success: true }));
	newPage.on('framenavigated', (frame) => {
		if (frame === newPage.mainFrame()) logAction({ action: 'navigate', source: 'agent', url: frame.url(), success: true });
	});
	try { await setupActionTracking(newPage); } catch (err) {
		childLog('warn', 'action-tracking-setup-failed', { url: newPage.url(), error: err.message });
	}
});


await page.goto('${escapedUrl}');

process.on('SIGTERM', async () => {
	childLog('info', 'child-sigterm');
	await browser.close();
	process.exit(0);
});

process.on('SIGINT', async () => {
	childLog('info', 'child-sigint');
	await browser.close();
	process.exit(0);
});

process.on('uncaughtException', (err) => {
	childLog('error', 'uncaught-exception', { message: err.message, stack: err.stack });
	process.exit(1);
});

process.on('unhandledRejection', (reason) => {
	childLog('warn', 'unhandled-rejection', { reason: String(reason) });
});

process.on('exit', (code) => {
	childLog('info', 'child-exit', { code, pid: process.pid, port: ${port} });
});

childLog('info', 'child-launched', { port: ${port}, pid: process.pid, session: '${session}' });

await new Promise(() => {});
`;

  const childStderrFd = openSync(runLogPath, "a");

  const child = spawn("node", ["--input-type=module", "-e", launcherCode], {
    detached: true,
    stdio: ["ignore", "ignore", childStderrFd],
    cwd: dirname(createRequire(import.meta.url).resolve("libretto")),
  });
  child.unref();

  log.info("open-child-spawned", { pid: child.pid, port, session });

  let childSpawnError: Error | null = null;
  let childEarlyExit: { code: number | null; signal: NodeJS.Signals | null } | null =
    null;

  child.on("error", (err) => {
    childSpawnError = err;
    log.error("open-child-spawn-error", { error: err, session, port });
  });

  child.on("exit", (code, signal) => {
    childEarlyExit = { code, signal };
    log.warn("open-child-exited", {
      code,
      signal,
      session,
      port,
      pid: child.pid,
    });
  });

  const cdpPollIntervalMs = 500;
  const cdpMaxAttempts = 30;
  const cdpStartupTimeoutMs = cdpPollIntervalMs * cdpMaxAttempts;

  for (let i = 0; i < cdpMaxAttempts; i++) {
    const spawnError = childSpawnError as Error | null;
    if (spawnError !== null) {
      const errWithCode = spawnError as Error & { code?: string };
      const hint =
        errWithCode.code === "ENOENT"
          ? " Ensure Node.js is available in PATH for child processes."
          : "";
      throw new Error(
        `Failed to launch browser child process: ${spawnError.message}.${hint} Check logs: ${runLogPath}`,
      );
    }

    const earlyExit = childEarlyExit as {
      code: number | null;
      signal: NodeJS.Signals | null;
    } | null;
    if (earlyExit !== null) {
      const status = earlyExit.code ?? earlyExit.signal ?? "unknown";
      throw new Error(
        `Browser child process exited before startup (status: ${status}). Check logs: ${runLogPath}`,
      );
    }

    await new Promise((r) => setTimeout(r, cdpPollIntervalMs));
    const ready = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then(() => true)
      .catch(() => false);
    if (i > 0 && i % 5 === 0) {
      log.info("open-waiting-for-cdp", { attempt: i, port, session });
    }
    if (ready) {
      writeSessionState({
        port,
        pid: child.pid!,
        session,
        runId,
        startedAt: new Date().toISOString(),
        mode: sessionMode,
        status: "active",
      });
      log.info("open-success", {
        url,
        mode: browserMode,
        sessionMode,
        session,
        port,
        runId,
        pid: child.pid,
      });
      console.log(`Browser open (${browserMode}): ${url}`);

      await new Promise((r) => setTimeout(r, 2000));
      return;
    }
  }

  log.error("open-timeout", {
    session,
    port,
    pid: child.pid,
    attempts: cdpMaxAttempts,
  });
  throw new Error(
    `Failed to connect to browser after ${Math.ceil(cdpStartupTimeoutMs / 1000)}s. Check startup logs: ${runLogPath}`,
  );
}

export async function runSave(urlOrDomain: string, session: string): Promise<void> {
  const log = getLog();
  log.info("save-start", { urlOrDomain, session });
  const { browser, context, page } = await connect(session);

  try {
    await new Promise((r) => setTimeout(r, 500));

    const domain = normalizeDomain(urlOrDomain);
    const profilePath = getProfilePath(domain);

    const cdpSession = await context.newCDPSession(page);
    const { cookies: rawCookies } = await cdpSession.send(
      "Network.getAllCookies",
    );

    const cookies = rawCookies.map((c: any) => {
      const cookie = { ...c };
      if (cookie.partitionKey && typeof cookie.partitionKey === "object") {
        delete cookie.partitionKey;
      }
      return cookie;
    });

    await cdpSession.detach();

    const origins: Array<{
      origin: string;
      localStorage: Array<{ name: string; value: string }>;
    }> = [];

    for (const ctx of browser.contexts()) {
      for (const pg of ctx.pages()) {
        try {
          const origin = new URL(pg.url()).origin;
          const localStorage = await pg.evaluate(() => {
            const items: Array<{ name: string; value: string }> = [];
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i);
              if (key) {
                items.push({
                  name: key,
                  value: window.localStorage.getItem(key) || "",
                });
              }
            }
            return items;
          });
          if (localStorage.length > 0) {
            origins.push({ origin, localStorage });
          }
        } catch {
          // Skip pages that can't be accessed.
        }
      }
    }

    const state = { cookies, origins };
    const fs = await import("node:fs/promises");
    await fs.mkdir(dirname(profilePath), { recursive: true });
    await fs.writeFile(profilePath, JSON.stringify(state, null, 2));

    log.info("save-success", {
      domain,
      profilePath,
      cookieCount: cookies.length,
      originCount: origins.length,
    });
    console.log(`Profile saved for ${domain}`);
    console.log(`   Location: ${profilePath}`);
    console.log(`   Cookies: ${cookies.length}, Origins: ${origins.length}`);
  } catch (err) {
    log.error("save-error", { error: err, urlOrDomain, session });
    throw err;
  } finally {
    disconnectBrowser(browser, session);
  }
}

export async function runClose(session: string): Promise<void> {
  const log = getLog();
  log.info("close-start", { session });
  const state = readSessionState(session);
  if (!state) {
    log.info("close-no-session", { session });
    console.log(`No browser running for session "${session}".`);
    return;
  }

  log.info("close-killing", { session, pid: state.pid, port: state.port });

  try {
    process.kill(state.pid, "SIGTERM");
  } catch (err) {
    log.warn("close-kill-failed", { error: err, session, pid: state.pid });
  }

  await new Promise((r) => setTimeout(r, 1500));

  clearSessionState(session);
  log.info("close-success", { session });
  console.log(`Browser closed (session: ${session}).`);
}

export function resolvePath(filePath: string): string {
  return join(process.cwd(), filePath);
}

export function getScreenshotBaseName(title: string): string {
  const sanitizedTitle = title
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 50);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${sanitizedTitle}-${timestamp}`;
}
