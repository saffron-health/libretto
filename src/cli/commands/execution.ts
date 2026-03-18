import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import * as moduleBuiltin from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { installInstrumentation } from "../../shared/instrumentation/index.js";
import type { LoggerApi } from "../../shared/logger/index.js";
import {
  connect,
  disconnectBrowser,
  resolveViewport,
} from "../core/browser.js";
import { parseViewportArg } from "./browser.js";
import { getPauseSignalPaths } from "../core/pause-signals.js";
import {
  assertSessionAvailableForStart,
  clearSessionState,
  readSessionState,
  setSessionStatus,
  type SessionState,
} from "../core/session.js";
import {
  readActionLog,
  readNetworkLog,
  wrapPageForActionLogging,
} from "../core/telemetry.js";
import type {
  RunIntegrationWorkerRequest,
} from "../workers/run-integration-worker-protocol.js";
import { SimpleCLI } from "../framework/simple-cli.js";
import {
  loadSessionStateMiddleware,
  pageOption,
  resolveSessionMiddleware,
  sessionOption,
} from "./shared.js";

type ExecFunction = (...args: unknown[]) => Promise<unknown>;
type RunIntegrationCommandRequest = RunIntegrationWorkerRequest & {
  tsconfigPath?: string;
};

type StripTypeScriptTypesFn = (
  code: string,
  options?: { mode?: "strip" | "transform" },
) => string;

const stripTypeScriptTypes = (
  moduleBuiltin as { stripTypeScriptTypes?: StripTypeScriptTypesFn }
).stripTypeScriptTypes;
const require = moduleBuiltin.createRequire(import.meta.url);
const tsxCliPath = require.resolve("tsx/cli");

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
  logger: LoggerApi,
  visualize = false,
  pageId?: string,
): Promise<void> {
  logger.info("exec-start", {
    session,
    codeLength: code.length,
    codePreview: code.slice(0, 200),
    visualize,
    pageId,
  });
  const { browser, context, page, pageId: resolvedPageId } = await connect(
    session,
    logger,
    10000,
    {
      pageId,
      requireSinglePage: true,
    },
  );

  const STALL_THRESHOLD_MS = 60_000;
  let lastActivityTs = Date.now();
  const onActivity = () => {
    lastActivityTs = Date.now();
  };

  const stallInterval = setInterval(() => {
    const silenceMs = Date.now() - lastActivityTs;
    if (silenceMs >= STALL_THRESHOLD_MS) {
      logger.warn("exec-stall-warning", {
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
    logger.info("exec-interrupted", {
      session,
      duration: Date.now() - execStartTs,
      codePreview: code.slice(0, 200),
    });
  };
  process.on("SIGINT", sigintHandler);

  wrapPageForActionLogging(page, session, resolvedPageId, onActivity);

  if (visualize) {
    await installInstrumentation(page, { visualize: true, logger });
  }

  try {
    const execState: Record<string, unknown> = {};

    const networkLog = (
      opts: { last?: number; filter?: string; method?: string; pageId?: string } = {},
    ) => {
      return readNetworkLog(session, opts);
    };

    const actionLog = (
      opts: {
        last?: number;
        filter?: string;
        action?: string;
        source?: string;
        pageId?: string;
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
    logger.info("exec-success", { session, hasResult: result !== undefined });
    if (result !== undefined) {
      console.log(
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
      );
    }
  } catch (err) {
    logger.error("exec-error", {
      error: err,
      session,
      codePreview: code.slice(0, 200),
    });
    throw err;
  } finally {
    clearInterval(stallInterval);
    process.removeListener("SIGINT", sigintHandler);
    disconnectBrowser(browser, logger, session);
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

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopExistingFailedRunSession(
  session: string,
  logger: LoggerApi,
): Promise<void> {
  const existingState = readSessionState(session, logger);
  if (!existingState || existingState.status !== "failed") {
    return;
  }
  logger.info("run-release-existing-failed-session", {
    session,
    pid: existingState.pid,
    port: existingState.port,
  });
  clearSessionState(session, logger);

  const stopDeadline = Date.now() + 3_000;
  while (isProcessRunning(existingState.pid) && Date.now() < stopDeadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (isProcessRunning(existingState.pid)) {
    logger.warn("run-release-existing-failed-session-timeout", {
      session,
      pid: existingState.pid,
    });
    console.warn(
      `Existing failed workflow process for session "${session}" (pid ${existingState.pid}) is still shutting down; continuing.`,
    );
    return;
  }
  console.log(
    `Closed existing failed workflow process for session "${session}" (pid ${existingState.pid}).`,
  );
}

function readJsonFileIfExists(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function readFailureDetails(path: string): {
  message?: string;
  phase?: "setup" | "workflow";
} | null {
  const raw = readJsonFileIfExists(path);
  if (!raw || typeof raw !== "object") return null;

  const message = (raw as { message?: unknown }).message;
  const phase = (raw as { phase?: unknown }).phase;

  return {
    message: typeof message === "string" ? message : undefined,
    phase: phase === "setup" || phase === "workflow" ? phase : undefined,
  };
}

async function waitForFailureDetails(
  path: string,
  timeoutMs = 1_000,
): Promise<{
  message?: string;
  phase?: "setup" | "workflow";
} | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const details = readFailureDetails(path);
    if (details?.message) return details;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return readFailureDetails(path);
}

function streamOutputSince(path: string, offset: number): number {
  if (!existsSync(path)) return offset;
  const output = readFileSync(path);
  if (output.length <= offset) return output.length;
  process.stdout.write(output.subarray(offset));
  return output.length;
}

type WaitForWorkflowOutcomeArgs = {
  session: string;
  pid: number;
};

type WorkflowOutcome = {
  status: "completed" | "paused" | "failed" | "exited";
  message?: string;
  phase?: "setup" | "workflow";
};

function clearSignalIfExists(path: string): void {
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // Ignore cleanup failures; next checks still validate actual state.
  }
}

async function waitForWorkflowOutcome(
  args: WaitForWorkflowOutcomeArgs,
): Promise<WorkflowOutcome> {
  const signalPaths = getPauseSignalPaths(args.session);
  if (args.pid <= 0) {
    return { status: "exited" };
  }
  let outputOffset = 0;

  while (true) {
    outputOffset = streamOutputSince(signalPaths.outputSignalPath, outputOffset);

    if (existsSync(signalPaths.failedSignalPath)) {
      outputOffset = streamOutputSince(signalPaths.outputSignalPath, outputOffset);
      const failureDetails = await waitForFailureDetails(signalPaths.failedSignalPath);
      return {
        status: "failed",
        message: failureDetails?.message,
        phase: failureDetails?.phase,
      };
    }

    if (existsSync(signalPaths.completedSignalPath)) {
      outputOffset = streamOutputSince(signalPaths.outputSignalPath, outputOffset);
      return { status: "completed" };
    }

    if (existsSync(signalPaths.pausedSignalPath)) {
      outputOffset = streamOutputSince(signalPaths.outputSignalPath, outputOffset);
      return { status: "paused" };
    }

    if (!isProcessRunning(args.pid)) {
      outputOffset = streamOutputSince(signalPaths.outputSignalPath, outputOffset);
      return { status: "exited" };
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
}

async function runResume(
  session: string,
  logger: LoggerApi,
  sessionState: SessionState,
): Promise<void> {
  const {
    pausedSignalPath,
    resumeSignalPath,
    completedSignalPath,
    failedSignalPath,
    outputSignalPath,
  } = getPauseSignalPaths(session);

  if (!existsSync(pausedSignalPath)) {
    throw new Error(
      `Session "${session}" is not paused. Run "libretto run ... --session ${session}" and call pause("${session}") first.`,
    );
  }

  if (!isProcessRunning(sessionState.pid)) {
    throw new Error(
      `No active paused workflow found for session "${session}" (worker pid ${sessionState.pid} is not running).`,
    );
  }

  // Clear stale pause/output markers before signaling resume so we always wait
  // for the next pause/completion and only stream post-resume logs.
  clearSignalIfExists(pausedSignalPath);
  clearSignalIfExists(outputSignalPath);
  clearSignalIfExists(completedSignalPath);
  clearSignalIfExists(failedSignalPath);
  setSessionStatus(session, "active", logger);

  writeFileSync(
    resumeSignalPath,
    JSON.stringify(
      {
        resumedAt: new Date().toISOString(),
        sourcePid: process.pid,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`Resume signal sent for session "${session}".`);

  const outcome = await waitForWorkflowOutcome({
    session,
    pid: sessionState.pid,
  });

  if (outcome.status === "completed") {
    setSessionStatus(session, "completed", logger);
    console.log("Integration completed.");
    return;
  }
  if (outcome.status === "failed") {
    setSessionStatus(session, "failed", logger);
    throw new Error(
      outcome.message
        ? `Workflow failed after resume: ${outcome.message}`
        : "Workflow failed after resume.",
    );
  }
  if (outcome.status === "exited") {
    setSessionStatus(session, "exited", logger);
    throw new Error(
      `Workflow process for session "${session}" exited before reporting completion or pause.`,
    );
  }
  setSessionStatus(session, "paused", logger);
  console.log("Workflow paused.");
}

async function runIntegrationFromFile(
  args: RunIntegrationCommandRequest,
  logger: LoggerApi,
): Promise<void> {
  await stopExistingFailedRunSession(args.session, logger);
  const signalPaths = getPauseSignalPaths(args.session);
  clearSignalIfExists(signalPaths.pausedSignalPath);
  clearSignalIfExists(signalPaths.resumeSignalPath);
  clearSignalIfExists(signalPaths.completedSignalPath);
  clearSignalIfExists(signalPaths.failedSignalPath);
  clearSignalIfExists(signalPaths.outputSignalPath);

  const workerEntryPath = fileURLToPath(
    new URL("../workers/run-integration-worker.js", import.meta.url),
  );
  const payload = JSON.stringify({
    integrationPath: args.integrationPath,
    exportName: args.exportName,
    session: args.session,
    params: args.params,
    headless: args.headless,
    visualize: args.visualize,
    authProfileDomain: args.authProfileDomain,
    viewport: args.viewport,
  } satisfies RunIntegrationWorkerRequest);
  const worker = spawn(process.execPath, [
    tsxCliPath,
    ...(args.tsconfigPath ? ["--tsconfig", args.tsconfigPath] : []),
    workerEntryPath,
    payload,
  ], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  worker.unref();
  const outcome = await waitForWorkflowOutcome({
    session: args.session,
    pid: worker.pid ?? 0,
  });
  if (outcome.status === "paused") {
    setSessionStatus(args.session, "paused", logger);
    console.log("Workflow paused.");
    return;
  }
  if (outcome.status === "failed") {
    setSessionStatus(args.session, "failed", logger);
    if (outcome.phase === "workflow") {
      throw new Error(
        `${outcome.message ?? "Workflow failed during run."}\nBrowser is still open. You can use \`exec\` to inspect it. Call \`run\` to re-run the workflow.`,
      );
    }
    throw new Error(outcome.message ?? "Workflow failed during run.");
  }
  if (outcome.status === "exited") {
    setSessionStatus(args.session, "exited", logger);
    throw new Error(
      "Workflow process exited before reporting completion or pause during run.",
    );
  }
  setSessionStatus(args.session, "completed", logger);
  console.log("Integration completed.");
}

export const execInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("codeParts", z.array(z.string()).default([]), {
      help: "Playwright TypeScript code to execute",
      variadic: true,
    }),
  ],
  named: {
    session: sessionOption(),
    visualize: SimpleCLI.flag({ help: "Enable ghost cursor + highlight visualization" }),
    page: pageOption(),
  },
}).refine(
  (input) => input.codeParts.length > 0,
  `Usage: libretto exec <code> [--session <name>] [--visualize]`,
);

export function createExecCommand(logger: LoggerApi) {
  return SimpleCLI.command({
    description: "Execute Playwright TypeScript code",
  })
    .input(execInput)
    .use(resolveSessionMiddleware)
    .use(loadSessionStateMiddleware)
    .handle(async ({ input, ctx }) => {
      await runExec(
        input.codeParts.join(" "),
        ctx.session,
        logger,
        input.visualize,
        input.page,
      );
    });
}

const runUsage =
  `Usage: libretto run <integrationFile> <integrationExport> [--params <json> | --params-file <path>] [--tsconfig <path>] [--headed|--headless] [--no-visualize]`;

export const runInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("integrationFile", z.string().optional(), {
      help: "Path to the integration file",
    }),
    SimpleCLI.positional("integrationExport", z.string().optional(), {
      help: "Named workflow export to run",
    }),
  ],
  named: {
    session: sessionOption(),
    params: SimpleCLI.option(z.string().optional(), {
      help: "Inline JSON params",
    }),
    paramsFile: SimpleCLI.option(z.string().optional(), {
      name: "params-file",
      help: "Path to a JSON params file",
    }),
    tsconfig: SimpleCLI.option(z.string().optional(), {
      help: "Path to a tsconfig used for workflow module resolution",
    }),
    headed: SimpleCLI.flag({ help: "Run in headed mode" }),
    headless: SimpleCLI.flag({ help: "Run in headless mode" }),
    noVisualize: SimpleCLI.flag({
      name: "no-visualize",
      help: "Disable ghost cursor + highlight visualization in headed mode",
    }),
    authProfile: SimpleCLI.option(z.string().optional(), {
      name: "auth-profile",
      help: "Domain for local auth profile (e.g. apps.example.com)",
    }),
    viewport: SimpleCLI.option(z.string().optional(), {
      help: "Viewport size as WIDTHxHEIGHT (e.g. 1920x1080)",
    }),
  },
})
  .refine(
    (input) => Boolean(input.integrationFile && input.integrationExport),
    runUsage,
  )
  .refine((input) => !(input.params && input.paramsFile), "Pass either --params or --params-file, not both.")
  .refine((input) => !(input.headed && input.headless), "Cannot pass both --headed and --headless.");

function resolveRunParams(
  rawInlineParams: string | undefined,
  paramsFile: string | undefined,
): unknown {
  if (paramsFile) {
    let content: string;
    try {
      content = readFileSync(paramsFile, "utf8");
    } catch {
      throw new Error(
        `Could not read --params-file "${paramsFile}". Ensure the file exists and is readable.`,
      );
    }
    return parseJsonArg("--params-file", content);
  }
  if (rawInlineParams) {
    return parseJsonArg("--params", rawInlineParams);
  }
  return {};
}

export function createRunCommand(logger: LoggerApi) {
  return SimpleCLI.command({
    description: "Run an exported Libretto workflow from a file",
  })
    .input(runInput)
    .use(resolveSessionMiddleware)
    .handle(async ({ input, ctx }) => {
      await stopExistingFailedRunSession(ctx.session, logger);
      assertSessionAvailableForStart(ctx.session, logger);

      const params = resolveRunParams(input.params, input.paramsFile);
      const headlessMode = input.headed
        ? false
        : input.headless
          ? true
          : undefined;
      const visualize = !input.noVisualize;
      const viewport = resolveViewport(parseViewportArg(input.viewport), logger);

      await runIntegrationFromFile({
        integrationPath: input.integrationFile!,
        exportName: input.integrationExport!,
        session: ctx.session,
        params,
        tsconfigPath: input.tsconfig,
        headless: headlessMode ?? false,
        visualize,
        authProfileDomain: input.authProfile,
        viewport,
      }, logger);
    });
}

export const resumeInput = SimpleCLI.input({
  positionals: [],
  named: {
    session: sessionOption(),
  },
});

export function createResumeCommand(logger: LoggerApi) {
  return SimpleCLI.command({
    description: "Resume a paused workflow for the current session",
  })
    .input(resumeInput)
    .use(resolveSessionMiddleware)
    .use(loadSessionStateMiddleware)
    .handle(async ({ ctx }) => {
      await runResume(ctx.session, logger, ctx.sessionState);
    });
}

export function createExecutionCommands(logger: LoggerApi) {
  return {
    exec: createExecCommand(logger),
    run: createRunCommand(logger),
    resume: createResumeCommand(logger),
  };
}
