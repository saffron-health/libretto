import { appendFileSync, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { cwd } from "node:process";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  launchBrowser,
  type LibrettoAuthProfile,
  type LibrettoWorkflowContext,
  type RunDebugPauseDetails,
} from "libretto";
import type { LoggerApi } from "libretto/logger";
import { getProfilePath, normalizeDomain } from "../core/browser.js";
import { getSessionDir } from "../core/context.js";
import { getPauseSignalPaths, removeSignalIfExists } from "../core/pause-signals.js";
import type { RunIntegrationWorkerRequest } from "./run-integration-worker-protocol.js";

const LIBRETTO_WORKFLOW_BRAND = Symbol.for("libretto.workflow");

type LoadedLibrettoWorkflow = {
  metadata: {
    authProfile?: LibrettoAuthProfile;
  };
  run: (ctx: LibrettoWorkflowContext, input: unknown) => Promise<unknown>;
};

type RunIntegrationOutcome = { status: "completed" };

const RESUME_POLL_INTERVAL_MS = 250;

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

async function waitForResumeSignal(args: {
  signalPaths: ReturnType<typeof getPauseSignalPaths>;
  session: string;
  details: RunDebugPauseDetails;
  onPaused?: (details: RunDebugPauseDetails) => Promise<void> | void;
}): Promise<void> {
  const { pausedSignalPath, resumeSignalPath } = args.signalPaths;
  await mkdir(getSessionDir(args.session), { recursive: true });
  await removeSignalIfExists(resumeSignalPath);
  await writeFile(
    pausedSignalPath,
    JSON.stringify(args.details, null, 2),
    "utf8",
  );
  await args.onPaused?.(args.details);

  while (!existsSync(resumeSignalPath)) {
    await new Promise((resolveWait) =>
      setTimeout(resolveWait, RESUME_POLL_INTERVAL_MS),
    );
  }

  await removeSignalIfExists(resumeSignalPath);
  await removeSignalIfExists(pausedSignalPath);
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

function resolveWorkflowStorageStatePath(workflow: LoadedLibrettoWorkflow): string | undefined {
  const authProfile = workflow.metadata.authProfile;
  if (authProfile?.type !== "local") {
    return undefined;
  }
  return resolveLocalAuthProfilePath(authProfile.domain);
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
    throw new Error(
      `Failed to import integration module at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
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
      `Export "${exportName}" in ${absolutePath} must be a Libretto workflow instance. Use workflow(...) from "libretto".`,
    );
  }

  return targetExport;
}

async function runIntegrationInternal(
  args: RunIntegrationWorkerRequest,
  options: {
    logger: LoggerApi;
    onPaused?: (details: RunDebugPauseDetails) => Promise<void> | void;
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
  await removeSignalIfExists(signalPaths.outputSignalPath);
  const restoreStdout = mirrorStdoutToFile(signalPaths.outputSignalPath);

  console.log(
    `Running integration "${args.exportName}" from ${absolutePath} (${args.headless ? "headless" : "headed"})...`,
  );

  const integrationLogger = logger.withScope("integration-run", {
    integrationPath: absolutePath,
    integrationExport: args.exportName,
    session: args.session,
  });
  const authProfile = workflow.metadata.authProfile;
  const storageStatePath = resolveWorkflowStorageStatePath(workflow);
  if (authProfile?.type === "local" && storageStatePath && !existsSync(storageStatePath)) {
    throw new Error(
      getMissingLocalAuthProfileError({
        domain: authProfile.domain,
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

  const workflowContext: LibrettoWorkflowContext = {
    logger: integrationLogger,
    page: browserSession.page,
    context: browserSession.context,
    browser: browserSession.browser,
    session: args.session,
    integrationPath: absolutePath,
    exportName: args.exportName,
    headless: args.headless,
    debug: args.debug,
    pause: async () => {
      const details: RunDebugPauseDetails = {
        sessionName: args.session,
        pausedAt: new Date().toISOString(),
        url: browserSession.page.url(),
      };
      console.log(`[pause] Paused at ${details.url}`);
      console.log("[pause] Waiting for resume signal...");
      await waitForResumeSignal({
        signalPaths,
        session: args.session,
        details,
        onPaused: options.onPaused,
      });
      console.log("[pause] Resume signal received. Continuing workflow...");
    },
  };

  try {
    try {
      await workflow.run(workflowContext, args.params ?? {});
    } catch (error) {
      await writeFile(
        signalPaths.failedSignalPath,
        JSON.stringify(
          {
            failedAt: new Date().toISOString(),
            message: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
        "utf8",
      );
      throw error;
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
  onPaused: (details: RunDebugPauseDetails) => Promise<void> | void,
): Promise<RunIntegrationOutcome> {
  return await runIntegrationInternal(args, {
    logger,
    onPaused,
  });
}
