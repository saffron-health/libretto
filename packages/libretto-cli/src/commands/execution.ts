import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fork } from "node:child_process";
import * as moduleBuiltin from "node:module";
import { fileURLToPath } from "node:url";
import type { Argv } from "yargs";
import { installInstrumentation } from "libretto/instrumentation";
import {
  connect,
  disconnectBrowser,
} from "../core/browser.js";
import { getLog } from "../core/context.js";
import { getPauseSignalPaths } from "../core/pause-signals.js";
import {
  assertSessionAvailableForStart,
  getSessionPermissionMode,
  readSessionStateOrThrow,
  readOnlySessionError,
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
  const mode = sessionState.mode ?? "read-only";
  if (mode !== "full-access") {
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

function readJsonFileIfExists(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function readFailureMessage(path: string): string | null {
  const raw = readJsonFileIfExists(path);
  if (!raw || typeof raw !== "object") return null;
  const message = (raw as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

async function waitForFailureMessage(
  path: string,
  timeoutMs = 1_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = readFailureMessage(path);
    if (message) return message;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return readFailureMessage(path);
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
      const message = await waitForFailureMessage(signalPaths.failedSignalPath);
      return { status: "failed", message: message ?? undefined };
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

async function runResume(session: string): Promise<void> {
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
      `Session "${session}" is not paused. Run "libretto-cli run ... --session ${session}" and call ctx.pause() first.`,
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
  setSessionStatus(session, "active");

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
    setSessionStatus(session, "completed");
    console.log("Integration completed.");
    return;
  }
  if (outcome.status === "failed") {
    setSessionStatus(session, "failed");
    throw new Error(
      outcome.message
        ? `Workflow failed after resume: ${outcome.message}`
        : "Workflow failed after resume.",
    );
  }
  if (outcome.status === "exited") {
    setSessionStatus(session, "exited");
    throw new Error(
      `Workflow process for session "${session}" exited before reporting completion or pause.`,
    );
  }
  setSessionStatus(session, "paused");
  console.log("Workflow paused.");
}

async function runIntegrationFromFile(args: RunIntegrationWorkerRequest): Promise<void> {
  assertSessionAvailableForStart(args.session);
  const signalPaths = getPauseSignalPaths(args.session);
  clearSignalIfExists(signalPaths.pausedSignalPath);
  clearSignalIfExists(signalPaths.resumeSignalPath);
  clearSignalIfExists(signalPaths.completedSignalPath);
  clearSignalIfExists(signalPaths.failedSignalPath);
  clearSignalIfExists(signalPaths.outputSignalPath);

  const workerEntryPath = fileURLToPath(
    new URL("../workers/run-integration-worker.js", import.meta.url),
  );
  const payload = JSON.stringify(args);
  const worker = fork(workerEntryPath, [payload], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: process.env,
  });
  worker.disconnect();
  worker.unref();
  const outcome = await waitForWorkflowOutcome({
    session: args.session,
    pid: worker.pid ?? 0,
  });
  if (outcome.status === "paused") {
    setSessionStatus(args.session, "paused");
    console.log("Workflow paused.");
    return;
  }
  if (outcome.status === "failed") {
    setSessionStatus(args.session, "failed");
    throw new Error(outcome.message ?? "Workflow failed during run.");
  }
  if (outcome.status === "exited") {
    setSessionStatus(args.session, "exited");
    throw new Error(
      "Workflow process exited before reporting completion or pause during run.",
    );
  }
  setSessionStatus(args.session, "completed");
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
          .option("allow-actions", {
            type: "boolean",
            default: false,
            hidden: true,
          })
          .option("debug", { type: "boolean" }),
      async (argv) => {
        const usage =
          "Usage: libretto-cli run <integrationFile> <integrationExport> [--params <json> | --params-file <path>] [--headed|--headless] [--debug]";
        const integrationPath = argv.integrationFile as string | undefined;
        const exportName = argv.integrationExport as string | undefined;
        if (!integrationPath || !exportName) {
          throw new Error(usage);
        }

        const session = String(argv.session);
        const allowActions = Boolean(
          argv["allow-actions"] ?? (argv as { allowActions?: boolean }).allowActions,
        );
        if (allowActions) {
          throw new Error(
            `--allow-actions is not supported for run. ${readOnlySessionError(session)}`,
          );
        }
        if (getSessionPermissionMode(session) !== "full-access") {
          throw new Error(readOnlySessionError(session));
        }

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

        const debugFlag = argv.debug as boolean | undefined;
        const debugMode =
          debugFlag !== undefined
            ? debugFlag
            : process.env.LIBRETTO_DEBUG === "true";

        await runIntegrationFromFile({
          integrationPath,
          exportName,
          session,
          params,
          headless: headlessMode ?? false,
          debug: debugMode,
        });
      },
    )
    .command(
      "resume",
      "Resume a paused workflow for the current session",
      (cmd) => cmd,
      async (argv) => {
        await runResume(String(argv.session));
      },
    );
}
