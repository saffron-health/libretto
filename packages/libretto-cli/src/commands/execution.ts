import { readFileSync } from "node:fs";
import { fork } from "node:child_process";
import * as moduleBuiltin from "node:module";
import { fileURLToPath } from "node:url";
import type { Argv } from "yargs";
import { installInstrumentation } from "libretto/instrumentation";
import {
  connect,
  disconnectBrowser,
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
import type {
  RunIntegrationWorkerMessage,
  RunIntegrationWorkerRequest,
} from "../workers/run-integration-worker-protocol";

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

function parseJsonArg(label: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isRunIntegrationWorkerMessage(
  value: unknown,
): value is RunIntegrationWorkerMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "completed") return true;
  if (
    candidate.type === "failed" &&
    typeof candidate.message === "string"
  ) {
    return true;
  }
  if (
    candidate.type === "paused" &&
    typeof candidate.details === "object" &&
    candidate.details !== null
  ) {
    const details = candidate.details as Record<string, unknown>;
    return (
      typeof details.sessionName === "string" &&
      typeof details.pausedAt === "string" &&
      typeof details.url === "string"
    );
  }
  return false;
}

async function runIntegrationFromFile(args: RunIntegrationWorkerRequest): Promise<void> {
  const workerEntryPath = fileURLToPath(
    new URL("./workers/run-integration-worker.js", import.meta.url),
  );
  const payload = JSON.stringify(args);
  const worker = fork(workerEntryPath, [payload], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: process.env,
  });

  const onStdout = (chunk: Buffer | string) => {
    process.stdout.write(chunk.toString());
  };
  const onStderr = (chunk: Buffer | string) => {
    process.stderr.write(chunk.toString());
  };
  worker.stdout?.on("data", onStdout);
  worker.stderr?.on("data", onStderr);

  const cleanup = () => {
    worker.stdout?.off("data", onStdout);
    worker.stderr?.off("data", onStderr);
    worker.removeAllListeners("message");
    worker.removeAllListeners("error");
    worker.removeAllListeners("exit");
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    worker.on("message", (raw: unknown) => {
      if (!isRunIntegrationWorkerMessage(raw)) return;
      if (raw.type === "completed") {
        resolveOnce();
        return;
      }
      if (raw.type === "paused") {
        console.log("Workflow paused.");
        if (worker.connected) {
          worker.disconnect();
        }
        worker.unref();
        resolveOnce();
        return;
      }
      rejectOnce(new Error(raw.message));
    });

    worker.on("error", (error) => {
      rejectOnce(error);
    });

    worker.on("exit", (code, signal) => {
      if (settled) return;
      if (code === 0) {
        resolveOnce();
        return;
      }
      const reason = signal
        ? `signal ${signal}`
        : `code ${code ?? 1}`;
      rejectOnce(new Error(`Integration worker exited with ${reason}.`));
    });
  });
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
        if (getSessionPermissionMode(session) !== "interactive") {
          throw new Error(readOnlySessionError(session));
        }

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
    );
}
