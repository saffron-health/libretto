import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import * as moduleBuiltin from "node:module";
import { cwd } from "node:process";
import { isAbsolute, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import type { Argv } from "yargs";
import { installInstrumentation } from "libretto/instrumentation";
import { setDebugMode } from "libretto/config";
import { launchBrowser } from "libretto/run";
import {
  type LibrettoAuthProfile,
  type LibrettoWorkflowContext,
} from "libretto";
import {
  connect,
  disconnectBrowser,
  getProfilePath,
  normalizeDomain,
} from "../core/browser";
import { getLog } from "../core/context";
import {
  getSessionPermissionMode,
  readSessionStateOrThrow,
  readOnlySessionError,
  resolveSessionMode,
} from "../core/session";
import {
  readActionLog,
  readNetworkLog,
  wrapPageForActionLogging,
} from "../core/telemetry";

type ExecFunction = (...args: unknown[]) => Promise<unknown>;
const LIBRETTO_WORKFLOW_BRAND = Symbol.for("libretto.workflow");

type StripTypeScriptTypesFn = (
  code: string,
  options?: { mode?: "strip" | "transform" },
) => string;

const stripTypeScriptTypes = (
  moduleBuiltin as { stripTypeScriptTypes?: StripTypeScriptTypesFn }
).stripTypeScriptTypes;

function withSuppressedStripTypeScriptWarning<T>(action: () => T): T {
  type EmitWarningFn = (...args: unknown[]) => void;
  const mutableProcess = process as unknown as { emitWarning: EmitWarningFn };
  const originalEmitWarning = mutableProcess.emitWarning;

  mutableProcess.emitWarning = (...args: unknown[]) => {
    const warning = args[0];
    const typeOrOptions = args[1];
    const warningMessage =
      typeof warning === "string"
        ? warning
        : warning instanceof Error
          ? warning.message
          : "";
    const warningType =
      typeof typeOrOptions === "string"
        ? typeOrOptions
        : typeof typeOrOptions === "object" &&
            typeOrOptions !== null &&
            "type" in typeOrOptions &&
            typeof (typeOrOptions as { type?: unknown }).type === "string"
          ? ((typeOrOptions as { type?: string }).type ?? "")
          : "";

    if (
      warningType === "ExperimentalWarning" &&
      warningMessage.includes("stripTypeScriptTypes")
    ) {
      return;
    }
    originalEmitWarning(...args);
  };

  try {
    return action();
  } finally {
    mutableProcess.emitWarning = originalEmitWarning;
  }
}

function compileTypeScriptExecFunction(
  code: string,
  helperNames: string[],
): ExecFunction | null {
  if (!stripTypeScriptTypes) return null;

  const wrappedSource = `(async function __librettoExec(${helperNames.join(", ")}) {\n${code}\n})`;
  const jsSource = withSuppressedStripTypeScriptWarning(() =>
    stripTypeScriptTypes(wrappedSource, { mode: "strip" }),
  );
  const createFunction = new Function(
    `return ${jsSource}`,
  ) as () => ExecFunction;
  return createFunction();
}

function compileExecFunction(
  code: string,
  helperNames: string[],
): ExecFunction {
  const typeStripped = compileTypeScriptExecFunction(code, helperNames);
  if (typeStripped) return typeStripped;

  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as new (...args: string[]) => ExecFunction;
  return new AsyncFunction(...helperNames, code);
}

async function runExec(
  code: string,
  session: string,
  visualize = false,
): Promise<void> {
  const log = getLog();
  const sessionState = readSessionStateOrThrow(session);
  const mode = resolveSessionMode(session, sessionState);
  if (mode !== "interactive") {
    throw new Error(readOnlySessionError(session));
  }

  log.info("exec-start", {
    session,
    codeLength: code.length,
    codePreview: code.slice(0, 200),
    visualize,
  });
  const { browser, context, page } = await connect(session);

  const STALL_THRESHOLD_MS = 60_000;
  let lastActivityTs = Date.now();
  const onActivity = () => {
    lastActivityTs = Date.now();
  };

  const stallInterval = setInterval(() => {
    const silenceMs = Date.now() - lastActivityTs;
    if (silenceMs >= STALL_THRESHOLD_MS) {
      log.warn("exec-stall-warning", {
        session,
        silenceMs,
        codePreview: code.slice(0, 200),
      });
      console.warn(
        `[stall-warning] No Playwright activity for ${Math.round(silenceMs / 1000)}s — exec may be hung (code: ${code.slice(0, 100)}...)`,
      );
    }
  }, STALL_THRESHOLD_MS);

  const execStartTs = Date.now();
  const sigintHandler = () => {
    log.info("exec-interrupted", {
      session,
      duration: Date.now() - execStartTs,
      codePreview: code.slice(0, 200),
    });
  };
  process.on("SIGINT", sigintHandler);

  wrapPageForActionLogging(page, session, onActivity);

  if (visualize) {
    await installInstrumentation(page, { visualize: true, logger: log });
  }

  try {
    const execState: Record<string, unknown> = {};

    const networkLog = (
      opts: { last?: number; filter?: string; method?: string } = {},
    ) => {
      return readNetworkLog(session, opts);
    };

    const actionLog = (
      opts: {
        last?: number;
        filter?: string;
        action?: string;
        source?: string;
      } = {},
    ) => {
      return readActionLog(session, opts);
    };

    const helpers = {
      page,
      context,
      state: execState,
      browser,
      networkLog,
      actionLog,
      console,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      fetch,
      URL,
      Buffer,
    };

    const helperNames = Object.keys(helpers);
    const fn = compileExecFunction(code, helperNames);

    const result = await fn(...Object.values(helpers));
    log.info("exec-success", { session, hasResult: result !== undefined });
    if (result !== undefined) {
      console.log(
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
      );
    }
  } catch (err) {
    log.error("exec-error", {
      error: err,
      session,
      codePreview: code.slice(0, 200),
    });
    throw err;
  } finally {
    clearInterval(stallInterval);
    process.removeListener("SIGINT", sigintHandler);
    disconnectBrowser(browser, session);
  }
}

function resolveLocalAuthProfilePath(domain: string): string {
  return getProfilePath(normalizeDomain(domain));
}

type LoadedLibrettoWorkflow = {
  metadata: {
    authProfile?: LibrettoAuthProfile;
  };
  run: (ctx: LibrettoWorkflowContext, input: unknown) => Promise<unknown>;
};

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

async function runIntegrationFromFile(args: {
  integrationPath: string;
  exportName: string;
  session: string;
  params: unknown;
  headless: boolean;
}): Promise<void> {
  const log = getLog();
  const absolutePath = isAbsolute(args.integrationPath)
    ? args.integrationPath
    : resolve(cwd(), args.integrationPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Integration file does not exist: ${absolutePath}`);
  }

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

  const targetExport = loadedModule[args.exportName];
  if (!targetExport) {
    const availableExports = Object.keys(loadedModule);
    const detail =
      availableExports.length > 0
        ? ` Available exports: ${availableExports.join(", ")}`
        : " The module has no exports.";
    throw new Error(
      `Export "${args.exportName}" was not found in ${absolutePath}.${detail}`,
    );
  }

  if (!isLoadedLibrettoWorkflow(targetExport)) {
    throw new Error(
      `Export "${args.exportName}" in ${absolutePath} must be a Libretto workflow instance. Use workflow(...) from "libretto".`,
    );
  }

  console.log(
    `Running integration "${args.exportName}" from ${absolutePath} (${args.headless ? "headless" : "headed"})...`,
  );

  const integrationLogger = log.withScope("integration-run", {
    integrationPath: absolutePath,
    integrationExport: args.exportName,
    session: args.session,
  });
  const workflow = targetExport;
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
  };

  try {
    await workflow.run(workflowContext, args.params ?? {});
    console.log("Integration completed.");
  } finally {
    await browserSession.close();
  }
}

function parseJsonArg(label: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function registerExecutionCommands(yargs: Argv): Argv {
  return yargs
    .command(
      "exec [code..]",
      "Execute Playwright TypeScript code",
      (cmd) => cmd.option("visualize", { type: "boolean", default: false }),
      async (argv) => {
        const codeParts = Array.isArray(argv.code)
          ? (argv.code as string[])
          : argv.code
            ? [String(argv.code)]
            : [];
        const code = codeParts.join(" ");
        if (!code) {
          throw new Error(
            "Usage: libretto-cli exec <code> [--session <name>] [--visualize]",
          );
        }
        await runExec(code, String(argv.session), Boolean(argv.visualize));
      },
    )
    .command(
      "run [integrationFile] [integrationExport]",
      "Run an exported Libretto workflow from a file",
      (cmd) =>
        cmd
          .option("params", { type: "string" })
          .option("params-file", { type: "string" })
          .option("headed", { type: "boolean", default: false })
          .option("headless", { type: "boolean", default: false })
          .option("debug", { type: "string" }),
      async (argv) => {
        const usage =
          "Usage: libretto-cli run <integrationFile> <integrationExport> [--params <json> | --params-file <path>] [--headed|--headless] [--debug <true|false>]";
        const integrationPath = argv.integrationFile as string | undefined;
        const exportName = argv.integrationExport as string | undefined;
        if (!integrationPath || !exportName) {
          throw new Error(usage);
        }

        const session = String(argv.session);

        const rawInlineParams = argv.params as string | undefined;
        const paramsFile = argv["params-file"] as string | undefined;
        if (rawInlineParams && paramsFile) {
          throw new Error("Pass either --params or --params-file, not both.");
        }

        const params = (() => {
          if (paramsFile) {
            const content = readFileSync(paramsFile, "utf8");
            return parseJsonArg("--params-file", content);
          }
          if (rawInlineParams) {
            return parseJsonArg("--params", rawInlineParams);
          }
          return {};
        })();

        const hasHeadedFlag = Boolean(argv.headed);
        const hasHeadlessFlag = Boolean(argv.headless);
        if (hasHeadedFlag && hasHeadlessFlag) {
          throw new Error("Cannot pass both --headed and --headless.");
        }
        const headlessMode = hasHeadedFlag
          ? false
          : hasHeadlessFlag
            ? true
            : undefined;

        const rawDebug = argv.debug as string | undefined;
        const debugMode = (() => {
          if (rawDebug === undefined) return true;
          const normalized = rawDebug.trim().toLowerCase();
          if (normalized === "true") return true;
          if (normalized === "false") return false;
          throw new Error(
            `Invalid value for --debug: "${rawDebug}". Expected true or false.`,
          );
        })();

        setDebugMode(debugMode);
        await runIntegrationFromFile({
          integrationPath,
          exportName,
          session,
          params,
          headless: headlessMode ?? false,
        });
      },
    );
}
