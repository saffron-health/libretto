import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import * as moduleBuiltin from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { LoggerApi } from "../../shared/logger/index.js";
import { resolveViewport } from "../core/browser.js";
import { parseViewportArg } from "./browser.js";
import { getPauseSignalPaths } from "../core/pause-signals.js";
import {
  assertSessionAvailableForStart,
  assertSessionAllowsCommand,
  clearSessionState,
  readSessionState,
  readSessionStateOrThrow,
  setSessionStatus,
  type SessionState,
} from "../core/session.js";
import { warnIfInstalledSkillOutOfDate } from "../core/skill-version.js";
import { readLibrettoConfig } from "../core/config.js";
import { resolveProviderName, getCloudProviderApi } from "../core/providers/index.js";
import { stripEmptyCatchHandlers } from "../core/exec-compiler.js";
import { DaemonClient } from "../core/daemon/index.js";
import type { RunIntegrationWorkerRequest } from "../workers/run-integration-worker-protocol.js";
import { SimpleCLI } from "../framework/simple-cli.js";
import {
  pageOption,
  sessionOption,
  withAutoSession,
  withRequiredSession,
} from "./shared.js";

type RunIntegrationCommandRequest = RunIntegrationWorkerRequest & {
  tsconfigPath?: string;
};
type ExecMode = "exec" | "readonly-exec";

const require = moduleBuiltin.createRequire(import.meta.url);
const tsxCliPath = require.resolve("tsx/cli");

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
    throw new Error(
      `Session "${session}" has no daemon socket. The browser daemon may have crashed. ` +
        `Close and reopen the session: libretto close --session ${session}`,
    );
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
    session: args.session,
    params: args.params,
    headless: args.headless,
    visualize: args.visualize,
    authProfileDomain: args.authProfileDomain,
    viewport: args.viewport,
    accessMode: args.accessMode,
    cdpEndpoint: args.cdpEndpoint,
    provider: args.provider,
  } satisfies RunIntegrationWorkerRequest);
  const worker = spawn(
    process.execPath,
    [
      tsxCliPath,
      ...(args.tsconfigPath ? ["--tsconfig", args.tsconfigPath] : []),
      workerEntryPath,
      payload,
    ],
    {
      detached: true,
      stdio: "ignore",
      env: process.env,
    },
  );
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

const runUsage = `Usage: libretto run <integrationFile> [--params <json> | --params-file <path>] [--tsconfig <path>] [--headed|--headless] [--read-only|--write-access] [--no-visualize] [--viewport WxH]`;

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
    let cdpEndpoint: string | undefined;
    let providerInfo: { name: string; sessionId: string } | undefined;
    let provider: ReturnType<typeof getCloudProviderApi> | undefined;
    if (providerName !== "local") {
      provider = getCloudProviderApi(providerName);
      console.log(
        `Creating ${providerName} browser session (session: ${ctx.session})...`,
      );
      const providerSession = await provider.createSession();
      ctx.logger.info("run-provider-session-created", {
        provider: providerName,
        sessionId: providerSession.sessionId,
        cdpEndpoint: providerSession.cdpEndpoint,
        liveViewUrl: providerSession.liveViewUrl,
      });
      if (providerSession.liveViewUrl) {
        console.log(`View live session: ${providerSession.liveViewUrl}`);
      }
      console.log(`Connecting to ${providerName} browser...`);
      cdpEndpoint = providerSession.cdpEndpoint;
      providerInfo = {
        name: providerName,
        sessionId: providerSession.sessionId,
      };
    }

    try {
      await runIntegrationFromFile(
        {
          integrationPath: input.integrationFile!,
          session: ctx.session,
          params,
          tsconfigPath: input.tsconfig,
          headless: cdpEndpoint ? true : (headlessMode ?? false),
          visualize,
          authProfileDomain: input.authProfile,
          viewport,
          accessMode: input.readOnly ? "read-only" : input.writeAccess ? "write-access" : (readLibrettoConfig().sessionMode ?? "write-access"),
          cdpEndpoint,
          provider: providerInfo,
        },
        ctx.logger,
      );
    } finally {
      if (provider && providerInfo) {
        try {
          const result = await provider.closeSession(providerInfo.sessionId);
          if (result.replayUrl) {
            console.log(`View recording: ${result.replayUrl}`);
          }
        } catch (cleanupErr) {
          console.error(
            `Failed to clean up ${providerInfo.name} session ${providerInfo.sessionId}:`,
            cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
          );
        }
      }
    }
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
