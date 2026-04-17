import type { BrowserContext, Page } from "playwright";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { cwd } from "node:process";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv } from "../../shared/env/load-env.js";
import {
  getDefaultWorkflowFromModuleExports,
  getWorkflowsFromModuleExports,
  instrumentContext,
  launchBrowser,
  type ExportedLibrettoWorkflow,
  type LibrettoWorkflowContext,
} from "../../index.js";
import type { LoggerApi } from "../../shared/logger/index.js";
import { parseSessionStateContent } from "../../shared/state/index.js";
import {
  getProfilePath,
  normalizeDomain,
  normalizeUrl,
} from "../core/browser.js";
import {
  getSessionActionsLogPath,
  getSessionDir,
  getSessionNetworkLogPath,
  getSessionStatePath,
} from "../core/context.js";
import {
  getPauseSignalPaths,
  removeSignalIfExists,
} from "../core/pause-signals.js";
import { installSessionTelemetry } from "../core/session-telemetry.js";
import type { RunIntegrationWorkerRequest } from "./run-integration-worker-protocol.js";

type LoadedLibrettoWorkflow = ExportedLibrettoWorkflow & {
  run: (ctx: LibrettoWorkflowContext, input: unknown) => Promise<unknown>;
};

type RunIntegrationOutcome =
  | { status: "completed" }
  | { status: "failed-held" };

const FAILURE_HOLD_POLL_INTERVAL_MS = 250;
const TSCONFIG_HINT =
  "TypeScript compilation failed. Pass --tsconfig <path> to run against a specific tsconfig.";

function isTsxCompileError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === "TransformError" ||
      error.message.startsWith("Cannot resolve tsconfig at path:"))
  );
}

function mirrorStdoutToFile(filePath: string): () => void {
  const stdout = process.stdout as NodeJS.WriteStream & {
    write: (...args: any[]) => boolean;
  };
  const originalWrite = stdout.write.bind(stdout);

  stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    try {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk), "utf8");
      appendFileSync(filePath, buffer);
    } catch {
      // Ignore log mirroring failures; primary stdout should still flow.
    }
    return originalWrite(chunk, ...args);
  }) as typeof stdout.write;

  return () => {
    stdout.write = originalWrite as typeof stdout.write;
  };
}

function readSessionStatePid(session: string): number | null {
  const statePath = getSessionStatePath(session);
  if (!existsSync(statePath)) return null;

  try {
    return (
      parseSessionStateContent(readFileSync(statePath, "utf8"), statePath)
        .pid ?? null
    );
  } catch {
    return null;
  }
}

async function waitForFailureSessionRelease(args: {
  session: string;
  expectedPid: number;
  logger: LoggerApi;
}): Promise<void> {
  const { session, expectedPid, logger } = args;
  logger.info("run-failure-session-hold", { session, expectedPid });

  while (true) {
    const currentPid = readSessionStatePid(session);
    if (currentPid !== expectedPid) {
      logger.info("run-failure-session-released", {
        session,
        expectedPid,
        currentPid,
      });
      return;
    }
    await new Promise((resolveWait) =>
      setTimeout(resolveWait, FAILURE_HOLD_POLL_INTERVAL_MS),
    );
  }
}

function getMissingLocalAuthProfileError(args: {
  normalizedDomain: string;
  profilePath: string;
  session: string;
}): string {
  return [
    `Local auth profile not found for domain "${args.normalizedDomain}".`,
    `Expected profile file: ${args.profilePath}`,
    "To create it:",
    `  1. libretto open https://${args.normalizedDomain} --headed --session ${args.session}`,
    "  2. Log in manually in the browser window.",
    `  3. libretto save ${args.normalizedDomain} --session ${args.session}`,
  ].join("\n");
}

function getAbsoluteIntegrationPath(integrationPath: string): string {
  const absolutePath = isAbsolute(integrationPath)
    ? integrationPath
    : resolve(cwd(), integrationPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Integration file does not exist: ${absolutePath}`);
  }
  return absolutePath;
}

async function loadDefaultWorkflow(
  absolutePath: string,
): Promise<LoadedLibrettoWorkflow> {
  let loadedModule: Record<string, unknown>;
  try {
    loadedModule = (await import(pathToFileURL(absolutePath).href)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const compileHint = isTsxCompileError(error) ? `\n${TSCONFIG_HINT}` : "";
    throw new Error(
      `Failed to import integration module at ${absolutePath}: ${message}${compileHint}`,
    );
  }

  const defaultWorkflow = getDefaultWorkflowFromModuleExports(loadedModule);
  if (defaultWorkflow) {
    return defaultWorkflow as LoadedLibrettoWorkflow;
  }

  const availableWorkflowNames = getWorkflowsFromModuleExports(loadedModule).map(
    (candidate) => candidate.name,
  );

  if (availableWorkflowNames.length === 0) {
    throw new Error(
      `No default-exported workflow found in ${absolutePath}. Export the workflow with \`export default workflow("name", handler)\`.`,
    );
  }

  throw new Error(
    `No default-exported workflow found in ${absolutePath}. libretto run only uses the file's default export. Available named workflows: ${availableWorkflowNames.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// tsx/esbuild __name shim for page.evaluate and similar Playwright APIs
// ---------------------------------------------------------------------------
// When tsx compiles TypeScript with keepNames: true, it wraps functions with
// __name(...) calls. Playwright serializes callback arguments to these APIs
// via Function#toString() and evaluates them in the browser context, which
// does not have __name defined. We intercept these methods and prepend a
// no-op __name polyfill so the serialized source executes correctly.
// ---------------------------------------------------------------------------

const __NAME_SHIM = [
  "const __name = (target, value) =>",
  "  Object.defineProperty(target, 'name', { value, configurable: true });",
].join(" ");

/**
 * Methods on Page/Frame that serialize a JS callback into the browser context.
 */
const EVALUATE_METHOD_NAMES = [
  "evaluate",
  "evaluateHandle",
  "waitForFunction",
  "$eval",
  "$$eval",
] as const;

/**
 * Wrap a function so that when Playwright serializes it, the source includes
 * a __name shim. We create a wrapper whose toString() output prepends the shim
 * before the original function body.
 */
function shimCallback<T>(fn: T): T {
  if (typeof fn !== "function") return fn;

  const original = fn as Function;
  const originalSource = original.toString();

  // Only shim if the source actually references __name
  if (!originalSource.includes("__name")) return fn;

  // Build a wrapper that Playwright will serialize via toString().
  // The wrapper source includes the __name shim followed by the original
  // function invocation.
  const shimmedSource = `${__NAME_SHIM}\nreturn (${originalSource}).apply(this, arguments);`;

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const shimmed = new Function(shimmedSource) as T & Function;

  // Preserve arity information for Playwright's serializer
  Object.defineProperty(shimmed, "length", {
    value: original.length,
    configurable: true,
  });

  return shimmed as T;
}

/**
 * Return a proxied Page where evaluate-family methods automatically shim
 * their first (callback) argument with a __name polyfill.
 */
function shimPageEvaluateMethods(page: Page): Page {
  return new Proxy(page, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (
        typeof prop === "string" &&
        (EVALUATE_METHOD_NAMES as readonly string[]).includes(prop) &&
        typeof value === "function"
      ) {
        return function (this: unknown, ...args: unknown[]) {
          if (args.length > 0) {
            args[0] = shimCallback(args[0]);
          }
          return (value as Function).apply(target, args);
        };
      }

      // Also proxy mainFrame() and locator() so their evaluate methods are shimmed
      if (prop === "mainFrame" && typeof value === "function") {
        return function (this: unknown, ...args: unknown[]) {
          const frame = (value as Function).apply(target, args);
          return shimEvaluateMethods(frame);
        };
      }

      if (prop === "locator" && typeof value === "function") {
        return function (this: unknown, ...args: unknown[]) {
          const locator = (value as Function).apply(target, args);
          return shimEvaluateMethods(locator);
        };
      }

      return value;
    },
  });
}

/**
 * Generic evaluate-method shim for Frame, Locator, ElementHandle, etc.
 */
function shimEvaluateMethods<T extends object>(obj: T): T {
  return new Proxy(obj, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (
        typeof prop === "string" &&
        (EVALUATE_METHOD_NAMES as readonly string[]).includes(prop) &&
        typeof value === "function"
      ) {
        return function (this: unknown, ...args: unknown[]) {
          if (args.length > 0) {
            args[0] = shimCallback(args[0]);
          }
          return (value as Function).apply(target, args);
        };
      }

      return value;
    },
  });
}

export async function installHeadedWorkflowVisualization(args: {
  context: BrowserContext;
  logger: LoggerApi;
  instrument?: typeof instrumentContext;
}): Promise<void> {
  await (args.instrument ?? instrumentContext)(args.context, {
    visualize: true,
    logger: args.logger,
  });
}

async function runIntegrationInternal(
  args: RunIntegrationWorkerRequest,
  options: {
    logger: LoggerApi;
  },
): Promise<RunIntegrationOutcome> {
  const { logger } = options;
  const absolutePath = getAbsoluteIntegrationPath(args.integrationPath);

  const envPath = loadEnv();
  if (envPath) {
    logger.info("loaded-env", { path: envPath });
  }

  const workflow = await loadDefaultWorkflow(absolutePath);
  const signalPaths = getPauseSignalPaths(args.session);
  await removeSignalIfExists(signalPaths.pausedSignalPath);
  await removeSignalIfExists(signalPaths.resumeSignalPath);
  await removeSignalIfExists(signalPaths.completedSignalPath);
  await removeSignalIfExists(signalPaths.failedSignalPath);
  const restoreStdout = mirrorStdoutToFile(signalPaths.outputSignalPath);

  console.log(
    `Running workflow "${workflow.name}" from ${absolutePath} (${args.headless ? "headless" : "headed"})...`,
  );

  const integrationLogger = logger.withScope("integration-run", {
    integrationPath: absolutePath,
    workflowName: workflow.name,
    session: args.session,
  });

  // Resolve auth profile from CLI flag (--auth-profile <domain>)
  const authProfileDomain = args.authProfileDomain;
  const normalizedAuthProfileDomain = authProfileDomain
    ? normalizeDomain(normalizeUrl(authProfileDomain))
    : undefined;
  const storageStatePath = normalizedAuthProfileDomain
    ? getProfilePath(normalizedAuthProfileDomain)
    : undefined;
  if (
    normalizedAuthProfileDomain &&
    storageStatePath &&
    !existsSync(storageStatePath)
  ) {
    throw new Error(
      getMissingLocalAuthProfileError({
        normalizedDomain: normalizedAuthProfileDomain,
        profilePath: storageStatePath,
        session: args.session,
      }),
    );
  }
  const browserSession = await launchBrowser({
    sessionName: args.session,
    headless: args.headless,
    storageStatePath,
    viewport: args.viewport,
    accessMode: args.accessMode,
    cdpEndpoint: args.cdpEndpoint,
    provider: args.provider,
  });
  if (!args.headless && args.visualize !== false) {
    await installHeadedWorkflowVisualization({
      context: browserSession.context,
      logger: integrationLogger,
    });
  }
  const actionsLogPath = getSessionActionsLogPath(args.session);
  const networkLogPath = getSessionNetworkLogPath(args.session);
  await installSessionTelemetry({
    context: browserSession.context,
    initialPage: browserSession.page,
    includeUserDomActions: true,
    logAction: (entry) => {
      appendFileSync(actionsLogPath, JSON.stringify(entry) + "\n");
    },
    logNetwork: (entry) => {
      appendFileSync(networkLogPath, JSON.stringify(entry) + "\n");
    },
  });

  const workflowContext: LibrettoWorkflowContext = {
    session: args.session,
    page: shimPageEvaluateMethods(browserSession.page),
  };

  try {
    try {
      await workflow.run(workflowContext, args.params ?? {});
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await writeFile(
        signalPaths.failedSignalPath,
        JSON.stringify(
          {
            failedAt: new Date().toISOString(),
            message: errorMessage,
            phase: "workflow",
          },
          null,
          2,
        ),
        "utf8",
      );
      await waitForFailureSessionRelease({
        session: args.session,
        expectedPid: process.pid,
        logger,
      });
      return { status: "failed-held" };
    }
    await writeFile(
      signalPaths.completedSignalPath,
      JSON.stringify({ completedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    return { status: "completed" };
  } finally {
    restoreStdout();
    await browserSession.close();
  }
}

export async function runIntegrationFromFileInWorker(
  args: RunIntegrationWorkerRequest,
  logger: LoggerApi,
): Promise<RunIntegrationOutcome> {
  return await runIntegrationInternal(args, {
    logger,
  });
}
