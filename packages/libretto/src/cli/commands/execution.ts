import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import * as moduleBuiltin from "node:module";
import { z } from "zod";
import { installInstrumentation } from "../../shared/instrumentation/index.js";
import type { LoggerApi } from "../../shared/logger/index.js";
import {
  connect,
  disconnectBrowser,
  runClose,
  resolveViewport,
} from "../core/browser.js";
import { parseViewportArg } from "./browser.js";
import { getPauseSignalPaths } from "../core/pause-signals.js";
import {
  assertSessionAvailableForStart,
  assertSessionAllowsCommand,
  clearSessionState,
  logFileForSession,
  readSessionState,
  readSessionStateOrThrow,
  setSessionStatus,
  writeSessionState,
  type SessionState,
} from "../core/session.js";
import { warnIfInstalledSkillOutOfDate } from "../core/skill-version.js";
import { readLibrettoConfig } from "../core/config.js";
import { resolveProviderName } from "../core/providers/index.js";
import {
  compileExecFunction,
  stripEmptyCatchHandlers,
} from "../core/exec-compiler.js";
import { DaemonClient } from "../core/daemon/index.js";
import { createReadonlyExecHelpers } from "../core/readonly-exec.js";
import {
  readActionLog,
  readNetworkLog,
  wrapPageForActionLogging,
} from "../core/telemetry.js";
import type { SessionAccessMode } from "../../shared/state/index.js";
import { SimpleCLI } from "../framework/simple-cli.js";
import {
  pageOption,
  sessionOption,
  withAutoSession,
  withRequiredSession,
} from "./shared.js";

type RunIntegrationCommandRequest = {
  integrationPath: string;
  session: string;
  params: unknown;
  headless: boolean;
  visualize: boolean;
  viewport?: { width: number; height: number };
  accessMode: SessionAccessMode;
  authProfileDomain?: string;
  providerName?: string;
  stayOpenOnSuccess: boolean;
  tsconfigPath?: string;
};
type ExecMode = "exec" | "readonly-exec";

const require = moduleBuiltin.createRequire(import.meta.url);

function writeDaemonExecOutput(output?: { stdout: string; stderr: string }) {
  if (output?.stdout) {
    process.stdout.write(output.stdout);
  }
  if (output?.stderr) {
    process.stderr.write(output.stderr);
  }
}

async function execViaDaemon(
  code: string,
  session: string,
  daemonSocketPath: string,
  logger: LoggerApi,
  options: {
    visualize?: boolean;
    pageId?: string;
    mode?: ExecMode;
  },
): Promise<void> {
  const mode = options.mode ?? "exec";
  const { cleaned: cleanedCode, strippedCount } = stripEmptyCatchHandlers(code);
  if (strippedCount > 0) {
    console.log("(Stripped `.catch(() => {})` — letting errors bubble up)");
  }
  logger.info(`${mode}-start`, {
    session,
    codeLength: cleanedCode.length,
    codePreview: cleanedCode.slice(0, 200),
    visualize: options.visualize,
    pageId: options.pageId,
    via: "daemon",
  });

  const client = new DaemonClient(daemonSocketPath);

  const response =
    mode === "exec"
      ? await client.exec({
          code: cleanedCode,
          pageId: options.pageId,
          visualize: options.visualize,
        })
      : await client.readonlyExec({
          code: cleanedCode,
          pageId: options.pageId,
        });

  if (!response.ok) {
    writeDaemonExecOutput(response.output);
    throw new Error(response.message);
  }

  const { result, output } = response.data;
  writeDaemonExecOutput(output);

  logger.info(`${mode}-success`, {
    session,
    hasResult: result !== undefined,
    via: "daemon",
  });
  if (result !== undefined) {
    console.log(
      typeof result === "string" ? result : JSON.stringify(result, null, 2),
    );
  } else {
    console.log("Executed successfully");
  }
}

async function execViaCdpFallback(
  code: string,
  session: string,
  logger: LoggerApi,
  options: {
    visualize?: boolean;
    pageId?: string;
    mode?: ExecMode;
  },
): Promise<void> {
  const visualize = options.visualize ?? false;
  const pageId = options.pageId;
  const mode = options.mode ?? "exec";
  const { cleaned: cleanedCode, strippedCount } = stripEmptyCatchHandlers(code);
  if (strippedCount > 0) {
    console.log("(Stripped `.catch(() => {})` — letting errors bubble up)");
  }
  logger.info(`${mode}-start`, {
    session,
    codeLength: cleanedCode.length,
    codePreview: cleanedCode.slice(0, 200),
    visualize,
    pageId,
    via: "cdp-fallback",
  });

  const {
    browser,
    context,
    page,
    pageId: resolvedPageId,
  } = await connect(session, logger, 10000, {
    pageId,
  });

  const STALL_THRESHOLD_MS = 60_000;
  let lastActivityTs = Date.now();
  const onActivity = () => {
    lastActivityTs = Date.now();
  };

  const stallInterval = setInterval(() => {
    const silenceMs = Date.now() - lastActivityTs;
    if (silenceMs >= STALL_THRESHOLD_MS) {
      logger.warn(`${mode}-stall-warning`, {
        session,
        silenceMs,
        codePreview: cleanedCode.slice(0, 200),
        via: "cdp-fallback",
      });
      console.warn(
        `[stall-warning] No Playwright activity for ${Math.round(silenceMs / 1000)}s — ${mode} may be hung (code: ${cleanedCode.slice(0, 100)}...)`,
      );
    }
  }, STALL_THRESHOLD_MS);

  const execStartTs = Date.now();
  const sigintHandler = () => {
    logger.info(`${mode}-interrupted`, {
      session,
      duration: Date.now() - execStartTs,
      codePreview: cleanedCode.slice(0, 200),
      via: "cdp-fallback",
    });
  };
  process.on("SIGINT", sigintHandler);

  if (mode === "exec") {
    wrapPageForActionLogging(page, session, resolvedPageId, onActivity);
  }

  if (visualize && mode === "exec") {
    await installInstrumentation(page, { visualize: true, logger });
  }

  try {
    const execState: Record<string, unknown> = {};
    const helpers =
      mode === "readonly-exec"
        ? createReadonlyExecHelpers(page, { onActivity })
        : {
            page,
            context,
            state: execState,
            browser,
            networkLog: (
              opts: {
                last?: number;
                filter?: string;
                method?: string;
                pageId?: string;
              } = {},
            ) => readNetworkLog(session, opts),
            actionLog: (
              opts: {
                last?: number;
                filter?: string;
                action?: string;
                source?: string;
                pageId?: string;
              } = {},
            ) => readActionLog(session, opts),
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
    const fn = compileExecFunction(cleanedCode, helperNames);
    const result = await fn(...Object.values(helpers));
    logger.info(`${mode}-success`, {
      session,
      hasResult: result !== undefined,
      via: "cdp-fallback",
    });
    if (result !== undefined) {
      console.log(
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
      );
    } else {
      console.log("Executed successfully");
    }
  } catch (err) {
    logger.error(`${mode}-error`, {
      error: err,
      session,
      codePreview: cleanedCode.slice(0, 200),
      via: "cdp-fallback",
    });
    throw err;
  } finally {
    clearInterval(stallInterval);
    process.removeListener("SIGINT", sigintHandler);
    disconnectBrowser(browser, logger, session);
  }
}

async function runExec(
  code: string,
  session: string,
  logger: LoggerApi,
  options: {
    visualize?: boolean;
    pageId?: string;
    mode?: ExecMode;
  } = {},
): Promise<void> {
  const state = readSessionStateOrThrow(session);
  if (!state.daemonSocketPath) {
    // Compatibility fallback for failed runs created before `run` became
    // daemon-backed: those session states can have a live CDP endpoint/port but
    // no daemon socket. Keep `exec` inspection working until such sessions are
    // gone. Context: https://www.notion.so/Make-libretto-run-daemon-backed-for-failed-workflow-inspection-352ac9fb35f181c1b7d3f08c0a735e9d
    logger.warn(`${options.mode ?? "exec"}-daemon-socket-missing-cdp-fallback`, {
      session,
      hasCdpEndpoint: Boolean(state.cdpEndpoint),
      port: state.port,
    });
    return execViaCdpFallback(code, session, logger, options);
  }
  return execViaDaemon(code, session, state.daemonSocketPath, logger, options);
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

  if (existingState.pid == null) return;

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

type RunIntegrationResult = "completed" | "paused";

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
    outputOffset = streamOutputSince(
      signalPaths.outputSignalPath,
      outputOffset,
    );

    if (existsSync(signalPaths.failedSignalPath)) {
      outputOffset = streamOutputSince(
        signalPaths.outputSignalPath,
        outputOffset,
      );
      const failureDetails = await waitForFailureDetails(
        signalPaths.failedSignalPath,
      );
      return {
        status: "failed",
        message: failureDetails?.message,
        phase: failureDetails?.phase,
      };
    }

    if (existsSync(signalPaths.completedSignalPath)) {
      outputOffset = streamOutputSince(
        signalPaths.outputSignalPath,
        outputOffset,
      );
      return { status: "completed" };
    }

    if (existsSync(signalPaths.pausedSignalPath)) {
      outputOffset = streamOutputSince(
        signalPaths.outputSignalPath,
        outputOffset,
      );
      return { status: "paused" };
    }

    if (!isProcessRunning(args.pid)) {
      outputOffset = streamOutputSince(
        signalPaths.outputSignalPath,
        outputOffset,
      );
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

  if (sessionState.pid == null || !isProcessRunning(sessionState.pid)) {
    throw new Error(
      `No active paused workflow found for session "${session}" (worker pid ${sessionState.pid ?? "unknown"} is not running).`,
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
    pid: sessionState.pid!,
  });

  if (outcome.status === "completed") {
    setSessionStatus(session, "completed", logger);
    console.log("Integration completed.");
    if (sessionState.stayOpenOnSuccess) {
      console.log(
        `Browser is still open for session "${session}". Close it with: libretto close --session ${session}`,
      );
    } else {
      await runClose(session, logger);
    }
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
): Promise<RunIntegrationResult> {
  await stopExistingFailedRunSession(args.session, logger);
  const signalPaths = getPauseSignalPaths(args.session);
  clearSignalIfExists(signalPaths.pausedSignalPath);
  clearSignalIfExists(signalPaths.resumeSignalPath);
  clearSignalIfExists(signalPaths.completedSignalPath);
  clearSignalIfExists(signalPaths.failedSignalPath);
  clearSignalIfExists(signalPaths.outputSignalPath);

  const runLogPath = logFileForSession(args.session);
  const {
    pid,
    socketPath: daemonSocketPath,
    provider,
  } = await DaemonClient.spawn({
    config: {
      session: args.session,
      browser: args.providerName
        ? { kind: "provider", providerName: args.providerName }
        : {
            kind: "launch",
            headed: !args.headless,
            viewport: args.viewport ?? { width: 1366, height: 768 },
          },
      workflow: {
        integrationPath: args.integrationPath,
        params: args.params,
        visualize: args.visualize,
        stayOpenOnSuccess: args.stayOpenOnSuccess,
        tsconfigPath: args.tsconfigPath,
        authProfileDomain: args.authProfileDomain,
      },
    },
    logger,
    logPath: runLogPath,
    startupTimeoutMs: 60_000,
  });

  writeSessionState(
    {
      port: 0,
      pid,
      cdpEndpoint: provider?.cdpEndpoint,
      session: args.session,
      startedAt: new Date().toISOString(),
      status: "active",
      mode: args.accessMode,
      viewport: args.viewport,
      stayOpenOnSuccess: args.stayOpenOnSuccess,
      daemonSocketPath,
      provider: provider
        ? { name: provider.name, sessionId: provider.sessionId }
        : undefined,
    },
    logger,
  );
  if (provider?.liveViewUrl) {
    console.log(`View live session: ${provider.liveViewUrl}`);
  }

  const outcome = await waitForWorkflowOutcome({
    session: args.session,
    pid,
  });
  if (outcome.status === "paused") {
    setSessionStatus(args.session, "paused", logger);
    console.log("Workflow paused.");
    return "paused";
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
  if (args.stayOpenOnSuccess) {
    console.log(
      `Browser is still open for session "${args.session}". Close it with: libretto close --session ${args.session}`,
    );
  } else {
    await runClose(args.session, logger);
  }
  return "completed";
}

function readStdinSync(): string | null {
  if (process.stdin.isTTY === true) return null;
  try {
    const content = readFileSync(0, "utf8");
    return content.trim().length > 0 ? content : null;
  } catch {
    return null;
  }
}

export const execInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("code", z.string().optional(), {
      help: "Playwright TypeScript code to execute",
    }),
  ],
  named: {
    session: sessionOption(),
    visualize: SimpleCLI.flag({
      help: "Enable ghost cursor + highlight visualization",
    }),
    page: pageOption(),
  },
}).refine(
  (input) => input.code !== undefined,
  `Usage: libretto exec <code|-> [--session <name>] [--visualize]\n       echo '<code>' | libretto exec - [--session <name>] [--visualize]`,
);

export const execCommand = SimpleCLI.command({
  description: "Execute Playwright TypeScript code",
})
  .input(execInput)
  .use(withRequiredSession())
  .handle(async ({ input, ctx }) => {
    assertSessionAllowsCommand(ctx.sessionState, "exec", ["write-access"]);
    const code = input.code!;
    const codeFromArgsOrStdin = code === "-" ? readStdinSync() : code;
    if (codeFromArgsOrStdin === null) {
      throw new Error(
        "Missing stdin input for `exec -`. Pipe Playwright code into stdin.",
      );
    }
    await runExec(
      codeFromArgsOrStdin,
      ctx.session,
      ctx.logger,
      {
        visualize: input.visualize,
        pageId: input.page,
        mode: "exec",
      },
    );
  });

export const readonlyExecInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("code", z.string().optional(), {
      help: "Read-only Playwright TypeScript code to execute",
    }),
  ],
  named: {
    session: sessionOption(),
    page: pageOption(),
  },
}).refine(
  (input) => input.code !== undefined,
  `Usage: libretto readonly-exec <code|-> [--session <name>] [--page <id>]\n       echo '<code>' | libretto readonly-exec - [--session <name>] [--page <id>]`,
);

export const readonlyExecCommand = SimpleCLI.command({
  description: "Execute read-only Playwright inspection code",
})
  .input(readonlyExecInput)
  .use(withRequiredSession())
  .handle(async ({ input, ctx }) => {
    const code = input.code!;
    const codeFromArgsOrStdin = code === "-" ? readStdinSync() : code;
    if (codeFromArgsOrStdin === null) {
      throw new Error(
        "Missing stdin input for `readonly-exec -`. Pipe inspection code into stdin.",
      );
    }
    await runExec(codeFromArgsOrStdin, ctx.session, ctx.logger, {
      pageId: input.page,
      mode: "readonly-exec",
    });
  });

const runUsage = `Usage: libretto run <integrationFile> [--params <json> | --params-file <path>] [--tsconfig <path>] [--headed|--headless] [--read-only|--write-access] [--no-visualize] [--stay-open-on-success] [--viewport WxH]`;

export const runInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("integrationFile", z.string().optional(), {
      help: "Path to the integration file",
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
    readOnly: SimpleCLI.flag({
      name: "read-only",
      help: "Create the session in read-only mode",
    }),
    writeAccess: SimpleCLI.flag({
      name: "write-access",
      help: "Create the session in write-access mode (overrides config default)",
    }),
    noVisualize: SimpleCLI.flag({
      name: "no-visualize",
      help: "Disable ghost cursor + highlight visualization in headed mode",
    }),
    stayOpenOnSuccess: SimpleCLI.flag({
      name: "stay-open-on-success",
      help: "Keep the browser session open after the workflow completes successfully",
    }),
    authProfile: SimpleCLI.option(z.string().optional(), {
      name: "auth-profile",
      help: "Domain for local auth profile (e.g. apps.example.com)",
    }),
    viewport: SimpleCLI.option(z.string().optional(), {
      help: "Viewport size as WIDTHxHEIGHT (e.g. 1920x1080)",
    }),
    provider: SimpleCLI.option(z.string().optional(), {
      help: "Browser provider (local, kernel, browserbase)",
      aliases: ["-p"],
    }),
  },
})
  .refine(
    (input) => Boolean(input.integrationFile),
    runUsage,
  )
  .refine(
    (input) => !(input.params && input.paramsFile),
    "Pass either --params or --params-file, not both.",
  )
  .refine(
    (input) => !(input.headed && input.headless),
    "Cannot pass both --headed and --headless.",
  )
  .refine(
    (input) => !(input.readOnly && input.writeAccess),
    "Cannot pass both --read-only and --write-access.",
  );

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

export const runCommand = SimpleCLI.command({
  description: "Run the default-exported Libretto workflow from a file",
})
  .input(runInput)
  .use(withAutoSession())
  .handle(async ({ input, ctx }) => {
    warnIfInstalledSkillOutOfDate();
    await stopExistingFailedRunSession(ctx.session, ctx.logger);
    assertSessionAvailableForStart(ctx.session, ctx.logger);

    const params = resolveRunParams(input.params, input.paramsFile);
    const headlessMode = input.headed
      ? false
      : input.headless
        ? true
        : undefined;
    const visualize = !input.noVisualize;
    const viewport = resolveViewport(
      parseViewportArg(input.viewport),
      ctx.logger,
    );

    const providerName = resolveProviderName(input.provider);
    const daemonProviderName = providerName === "local" ? undefined : providerName;
    if (daemonProviderName) {
      console.log(
        `Creating ${providerName} browser session (session: ${ctx.session})...`,
      );
      ctx.logger.info("run-provider-session-requested", {
        provider: providerName,
      });
      console.log(`Connecting to ${providerName} browser...`);
    }

    await runIntegrationFromFile(
      {
        integrationPath: input.integrationFile!,
        session: ctx.session,
        params,
        tsconfigPath: input.tsconfig,
        headless: daemonProviderName ? true : (headlessMode ?? false),
        visualize,
        authProfileDomain: input.authProfile,
        viewport,
        accessMode: input.readOnly ? "read-only" : input.writeAccess ? "write-access" : (readLibrettoConfig().sessionMode ?? "write-access"),
        providerName: daemonProviderName,
        stayOpenOnSuccess: input.stayOpenOnSuccess,
      },
      ctx.logger,
    );
  });

export const resumeInput = SimpleCLI.input({
  positionals: [],
  named: {
    session: sessionOption(),
  },
});

export const resumeCommand = SimpleCLI.command({
  description: "Resume a paused workflow for the current session",
})
  .input(resumeInput)
  .use(withRequiredSession())
  .handle(async ({ ctx }) => {
    await runResume(ctx.session, ctx.logger, ctx.sessionState);
  });

export const executionCommands = {
  exec: execCommand,
  "readonly-exec": readonlyExecCommand,
  run: runCommand,
  resume: resumeCommand,
};
