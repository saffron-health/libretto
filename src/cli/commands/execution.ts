import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import * as moduleBuiltin from "node:module";
import { fileURLToPath } from "node:url";
import type { Argv } from "yargs";
import { installInstrumentation } from "../../shared/instrumentation/index.js";
import type { LoggerApi } from "../../shared/logger/index.js";
import {
  connect,
  disconnectBrowser,
} from "../core/browser.js";
import { getPauseSignalPaths } from "../core/pause-signals.js";
import {
  assertSessionAvailableForStart,
  clearSessionState,
  readSessionState,
  readSessionStateOrThrow,
  setSessionStatus,
} from "../core/session.js";
import {
  readActionLog,
  readNetworkLog,
  wrapPageForActionLogging,
} from "../core/telemetry.js";
import type {
  RunIntegrationWorkerRequest,
} from "../workers/run-integration-worker-protocol.js";

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
  readSessionStateOrThrow(session);

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

type WorkflowFailurePhase = "setup" | "workflow";

type WorkflowFailureSignal = {
  message: string;
  phase?: WorkflowFailurePhase;
};

function readFailureSignal(path: string): WorkflowFailureSignal | null {
  const raw = readJsonFileIfExists(path);
  if (!raw || typeof raw !== "object") return null;
  const message = (raw as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  const phase = (raw as { phase?: unknown }).phase;
  return {
    message,
    phase: phase === "setup" || phase === "workflow" ? phase : undefined,
  };
}

async function waitForFailureSignal(
  path: string,
  timeoutMs = 1_000,
): Promise<WorkflowFailureSignal | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const failure = readFailureSignal(path);
    if (failure) return failure;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return readFailureSignal(path);
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
  failurePhase?: WorkflowFailurePhase;
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
      const failure = await waitForFailureSignal(signalPaths.failedSignalPath);
      return {
        status: "failed",
        message: failure?.message,
        failurePhase: failure?.phase,
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

async function runResume(session: string, logger: LoggerApi): Promise<void> {
  const state = readSessionStateOrThrow(session);
  const {
    pausedSignalPath,
    resumeSignalPath,
    completedSignalPath,
    failedSignalPath,
    outputSignalPath,
  } = getPauseSignalPaths(session);

  if (!existsSync(pausedSignalPath)) {
    throw new Error(
      `Session "${session}" is not paused. Run "libretto-cli run ... --session ${session}" and call pause() first.`,
    );
  }

  if (!isProcessRunning(state.pid)) {
    throw new Error(
      `No active paused workflow found for session "${session}" (worker pid ${state.pid} is not running).`,
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
    pid: state.pid,
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
  assertSessionAvailableForStart(args.session, logger);
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
    authProfileDomain: args.authProfileDomain,
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
    const message = outcome.message ?? "Workflow failed during run.";
    if (outcome.failurePhase === "workflow") {
      throw new Error(
        `${message}\nBrowser is still open. You can use \`exec\` to inspect it. Call \`run\` to re-run the workflow.`,
      );
    }
    throw new Error(message);
  }
  if (outcome.status === "exited") {
    setSessionStatus(args.session, "exited", logger);
    throw new Error(
      "Workflow process exited before reporting completion or pause during run.",
    );
  }
  setSessionStatus(args.session, "completed", logger);
}

export function registerExecutionCommands(yargs: Argv, logger: LoggerApi): Argv {
  return yargs
    .command(
      "exec [code..]",
      "Execute Playwright TypeScript code",
      (cmd) =>
        cmd
          .option("visualize", { type: "boolean", default: false })
          .option("page", { type: "string" }),
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
        await runExec(
          code,
          String(argv.session),
          logger,
          Boolean(argv.visualize),
          argv.page ? String(argv.page) : undefined,
        );
      },
    )
    .command(
      "run [integrationFile] [integrationExport]",
      "Run an exported Libretto workflow from a file",
      (cmd) =>
        cmd
          .option("params", { type: "string" })
          .option("params-file", { type: "string" })
          .option("tsconfig", { type: "string" })
          .option("headed", { type: "boolean", default: false })
          .option("headless", { type: "boolean", default: false })
          .option("auth-profile", { type: "string", describe: "Domain for local auth profile (e.g. apps.example.com)" }),
      async (argv) => {
        const usage =
          "Usage: libretto-cli run <integrationFile> <integrationExport> [--params <json> | --params-file <path>] [--tsconfig <path>] [--headed|--headless]";
        const integrationPath = argv.integrationFile as string | undefined;
        const exportName = argv.integrationExport as string | undefined;
        const legacyDebug = (argv as Record<string, unknown>).debug;
        if (legacyDebug !== undefined) {
          throw new Error(
            "The --debug flag has been removed. Run the command without --debug.",
          );
        }
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

        const authProfileDomain = argv["auth-profile"] as string | undefined;
        const tsconfigPath = argv.tsconfig as string | undefined;

        await runIntegrationFromFile({
          integrationPath,
          exportName,
          session,
          params,
          headless: headlessMode ?? false,
          authProfileDomain,
          tsconfigPath,
        }, logger);
      },
    )
    .command(
      "resume",
      "Resume a paused workflow for the current session",
      (cmd) => cmd,
      async (argv) => {
        await runResume(String(argv.session), logger);
      },
    );
}
