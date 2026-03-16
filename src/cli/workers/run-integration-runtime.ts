import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { cwd } from "node:process";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  launchBrowser,
  type LibrettoWorkflowContext,
} from "../../index.js";
import type { LoggerApi } from "../../shared/logger/index.js";
import { parseSessionStateContent } from "../../shared/state/index.js";
import { getProfilePath, normalizeDomain } from "../core/browser.js";
import {
  getSessionActionsLogPath,
  getSessionDir,
  getSessionNetworkLogPath,
  getSessionStatePath,
} from "../core/context.js";
import { getPauseSignalPaths, removeSignalIfExists } from "../core/pause-signals.js";
import { installSessionTelemetry } from "../core/session-telemetry.js";
import type { RunIntegrationWorkerRequest } from "./run-integration-worker-protocol.js";

const LIBRETTO_WORKFLOW_BRAND = Symbol.for("libretto.workflow");

type LoadedLibrettoWorkflow = {
  metadata: {};
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
    return parseSessionStateContent(readFileSync(statePath, "utf8"), statePath).pid;
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

function isLoadedLibrettoWorkflow(value: unknown): value is LoadedLibrettoWorkflow {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<PropertyKey, unknown>;
  return (
    candidate[LIBRETTO_WORKFLOW_BRAND] === true &&
    typeof candidate.run === "function" &&
    !!candidate.metadata &&
    typeof candidate.metadata === "object"
  );
}

function resolveLocalAuthProfilePath(domain: string): string {
  return getProfilePath(normalizeDomain(domain));
}

function getMissingLocalAuthProfileError(args: {
  domain: string;
  profilePath: string;
  session: string;
}): string {
  const normalizedDomain = normalizeDomain(args.domain);
  return [
    `Local auth profile not found for domain "${normalizedDomain}".`,
    `Expected profile file: ${args.profilePath}`,
    "To create it:",
    `  1. libretto-cli open https://${normalizedDomain} --headed --session ${args.session}`,
    "  2. Log in manually in the browser window.",
    `  3. libretto-cli save ${normalizedDomain} --session ${args.session}`,
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

async function loadWorkflowExport(
  absolutePath: string,
  exportName: string,
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

  const targetExport = loadedModule[exportName];
  if (!targetExport) {
    const availableExports = Object.keys(loadedModule);
    const detail =
      availableExports.length > 0
        ? ` Available exports: ${availableExports.join(", ")}`
        : " The module has no exports.";
    throw new Error(
      `Export "${exportName}" was not found in ${absolutePath}.${detail}`,
    );
  }

  if (!isLoadedLibrettoWorkflow(targetExport)) {
    throw new Error(
      [
        `Export "${exportName}" in ${absolutePath} is not a valid Libretto workflow.`,
        "",
        'A workflow must be created using the workflow() function from "libretto":',
        "",
        '  import { workflow } from "libretto";',
        "",
        `  export const ${exportName} = workflow<InputType, OutputType>(`,
        "    {},",
        "    async (ctx, input) => {",
        "      // ctx.page     — Playwright Page instance",
        "      // ctx.logger   — MinimalLogger",
        "      // ctx.services — injected dependencies (generic, default {})",
        "      // input        — JSON-serializable input matching InputType",
        "      return output; // must match OutputType",
        "    },",
        "  );",
      ].join("\n"),
    );
  }

  return targetExport;
}

async function runIntegrationInternal(
  args: RunIntegrationWorkerRequest,
  options: {
    logger: LoggerApi;
  },
): Promise<RunIntegrationOutcome> {
  const { logger } = options;
  const absolutePath = getAbsoluteIntegrationPath(args.integrationPath);
  const workflow = await loadWorkflowExport(absolutePath, args.exportName);
  const signalPaths = getPauseSignalPaths(args.session);
  await removeSignalIfExists(signalPaths.pausedSignalPath);
  await removeSignalIfExists(signalPaths.resumeSignalPath);
  await removeSignalIfExists(signalPaths.completedSignalPath);
  await removeSignalIfExists(signalPaths.failedSignalPath);
  const restoreStdout = mirrorStdoutToFile(signalPaths.outputSignalPath);

  console.log(
    `Running integration "${args.exportName}" from ${absolutePath} (${args.headless ? "headless" : "headed"})...`,
  );

  const integrationLogger = logger.withScope("integration-run", {
    integrationPath: absolutePath,
    integrationExport: args.exportName,
    session: args.session,
  });

  // Resolve auth profile from CLI flag (--auth-profile <domain>)
  const authProfileDomain = args.authProfileDomain;
  const storageStatePath = authProfileDomain
    ? resolveLocalAuthProfilePath(authProfileDomain)
    : undefined;
  if (authProfileDomain && storageStatePath && !existsSync(storageStatePath)) {
    throw new Error(
      getMissingLocalAuthProfileError({
        domain: authProfileDomain,
        profilePath: storageStatePath,
        session: args.session,
      }),
    );
  }
  const browserSession = await launchBrowser({
    sessionName: args.session,
    headless: args.headless,
    storageStatePath,
  });
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
    logger: integrationLogger,
    page: browserSession.page,
    services: {},
  };

  try {
    try {
      await workflow.run(workflowContext, args.params ?? {});
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
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
    console.log("Integration completed.");
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
