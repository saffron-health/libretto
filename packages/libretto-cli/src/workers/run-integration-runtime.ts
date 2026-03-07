import { existsSync } from "node:fs";
import { cwd } from "node:process";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  launchBrowser,
  isRunDebugPauseSignal,
  type LibrettoAuthProfile,
  type LibrettoWorkflowContext,
  type RunDebugPauseDetails,
} from "libretto";
import { getProfilePath, normalizeDomain } from "../core/browser.js";
import { getLog } from "../core/context.js";
import type { RunIntegrationWorkerRequest } from "./run-integration-worker-protocol.js";

const LIBRETTO_WORKFLOW_BRAND = Symbol.for("libretto.workflow");

type LoadedLibrettoWorkflow = {
  metadata: {
    authProfile?: LibrettoAuthProfile;
  };
  run: (ctx: LibrettoWorkflowContext, input: unknown) => Promise<unknown>;
};

type RunIntegrationOutcome =
  | { status: "completed" }
  | { status: "paused"; details: RunDebugPauseDetails };

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
    hangOnPause: boolean;
    onPaused?: (details: RunDebugPauseDetails) => Promise<void> | void;
  },
): Promise<RunIntegrationOutcome> {
  const log = getLog();
  const absolutePath = getAbsoluteIntegrationPath(args.integrationPath);
  const workflow = await loadWorkflowExport(absolutePath, args.exportName);

  console.log(
    `Running integration "${args.exportName}" from ${absolutePath} (${args.headless ? "headless" : "headed"})...`,
  );

  const integrationLogger = log.withScope("integration-run", {
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
  };

  let pauseDetails: RunDebugPauseDetails | null = null;
  try {
    try {
      await workflow.run(workflowContext, args.params ?? {});
      console.log("Integration completed.");
      return { status: "completed" };
    } catch (error) {
      if (!isRunDebugPauseSignal(error)) {
        throw error;
      }
      pauseDetails = error.details;
      await options.onPaused?.(pauseDetails);
      if (options.hangOnPause) {
        await new Promise<void>(() => {});
      }
      return { status: "paused", details: pauseDetails };
    }
  } finally {
    if (!(options.hangOnPause && pauseDetails)) {
      await browserSession.close();
    }
  }
}

export async function runIntegrationFromFileInWorker(
  args: RunIntegrationWorkerRequest,
  onPaused: (details: RunDebugPauseDetails) => Promise<void> | void,
): Promise<RunIntegrationOutcome> {
  return await runIntegrationInternal(args, {
    hangOnPause: true,
    onPaused,
  });
}
