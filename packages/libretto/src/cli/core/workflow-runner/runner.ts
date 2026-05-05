import type { BrowserContext, Page } from "playwright";
import type { LoggerApi } from "../../../shared/logger/index.js";
import type {
  ExportedLibrettoWorkflow,
  LibrettoWorkflowContext,
} from "../../../shared/workflow/workflow.js";
import {
  getAbsoluteIntegrationPath,
  installHeadedWorkflowVisualization,
  loadDefaultWorkflow,
} from "../workflow-runtime.js";

type WorkflowPausedState = {
  state: "paused";
  session: string;
  pausedAt: string;
  url?: string;
};

export type WorkflowFinishedArgs =
  | { result: "completed"; completedAt: string }
  | { result: "failed"; message: string; phase: "setup" | "workflow" };

type WorkflowFinishedState = {
  state: "finished";
} & WorkflowFinishedArgs;

export type WorkflowOutcome = WorkflowPausedState | WorkflowFinishedState;

export type WorkflowStatus =
  | { state: "idle" }
  | { state: "running" }
  | WorkflowOutcome;

type WorkflowLogEvent = {
  stream: "stdout" | "stderr";
  text: string;
};

export type WorkflowControllerConfig = {
  session: string;
  headed: boolean;
  page: Page;
  context: BrowserContext;
  logger: LoggerApi;
  onLog?: (event: WorkflowLogEvent) => void;
  onOutcome?: (outcome: WorkflowOutcome) => void;
};

export type WorkflowStartConfig = {
  integrationPath: string;
  params?: unknown;
  visualize?: boolean;
  loadedWorkflow?: ExportedLibrettoWorkflow;
};

type PendingPause = {
  resolve(): void;
};

type WritableStreamWithWrite = NodeJS.WriteStream & {
  write: NodeJS.WriteStream["write"];
};

export class WorkflowController {
  private status: WorkflowStatus = { state: "idle" };
  private pendingPause: PendingPause | undefined;
  private started = false;

  constructor(private readonly config: WorkflowControllerConfig) {}

  start(workflowConfig: WorkflowStartConfig): void {
    if (this.started) {
      throw new Error("Workflow controller has already started.");
    }

    this.started = true;
    this.status = { state: "running" };
    void this.run(workflowConfig);
  }

  pause(args: {
    session: string;
    pausedAt: string;
    url?: string;
  }): Promise<void> {
    if (this.pendingPause) {
      throw new Error("Workflow is already paused.");
    }

    return new Promise<void>((resolve) => {
      this.pendingPause = { resolve };
      this.status = { state: "paused", ...args };
      this.config.onOutcome?.(this.status);
    });
  }

  resume(): void {
    if (!this.pendingPause) {
      throw new Error("Workflow is not paused.");
    }

    const pendingPause = this.pendingPause;
    this.pendingPause = undefined;
    this.status = { state: "running" };
    pendingPause.resolve();
  }

  getStatus(): WorkflowStatus {
    return this.status;
  }

  private async run(workflowConfig: WorkflowStartConfig): Promise<void> {
    const restoreOutput = this.captureProcessOutput();
    try {
      const absolutePath = getAbsoluteIntegrationPath(
        workflowConfig.integrationPath,
      );
      const workflow =
        workflowConfig.loadedWorkflow ??
        (await loadDefaultWorkflow(absolutePath));
      const workflowLogger = this.config.logger.withScope("integration-run", {
        integrationPath: absolutePath,
        workflowName: workflow.name,
        session: this.config.session,
      });

      console.log(
        `Running workflow "${workflow.name}" from ${absolutePath} (${this.config.headed ? "headed" : "headless"})...`,
      );

      if (this.config.headed && workflowConfig.visualize !== false) {
        await installHeadedWorkflowVisualization({
          context: this.config.context,
          logger: workflowLogger,
        });
      }

      // tsx/esbuild can inject __name() wrappers when keepNames is true.
      // Playwright serializes callbacks via Function#toString() into the browser
      // context, which lacks __name, causing ReferenceError without this polyfill.
      await this.config.context.addInitScript(() => {
        (globalThis as Record<string, unknown>).__name = (
          target: unknown,
          value: string,
        ) =>
          Object.defineProperty(target as object, "name", {
            value,
            configurable: true,
          });
      });

      const workflowContext: LibrettoWorkflowContext = {
        session: this.config.session,
        page: this.config.page,
      };

      try {
        await workflow.run(workflowContext, workflowConfig.params ?? {});
      } catch (error) {
        this.emitOutcome({
          state: "finished",
          result: "failed",
          message: error instanceof Error ? error.message : String(error),
          phase: "workflow",
        });
        return;
      }

      this.emitOutcome({
        state: "finished",
        result: "completed",
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.emitOutcome({
        state: "finished",
        result: "failed",
        message: error instanceof Error ? error.message : String(error),
        phase: "setup",
      });
    } finally {
      restoreOutput();
    }
  }

  private emitOutcome(outcome: WorkflowOutcome): void {
    this.resolvePendingPause();
    this.status = outcome;
    this.config.onOutcome?.(outcome);
  }

  private resolvePendingPause(): void {
    const pendingPause = this.pendingPause;
    if (!pendingPause) return;

    this.pendingPause = undefined;
    pendingPause.resolve();
  }

  private captureProcessOutput(): () => void {
    const stdout = process.stdout as WritableStreamWithWrite;
    const stderr = process.stderr as WritableStreamWithWrite;
    const originalStdoutWrite = stdout.write;
    const originalStderrWrite = stderr.write;

    stdout.write = ((...writeArgs: Parameters<typeof stdout.write>) => {
      const [chunk] = writeArgs;
      this.config.onLog?.({ stream: "stdout", text: chunkToString(chunk) });
      return Reflect.apply(originalStdoutWrite, stdout, writeArgs) as boolean;
    }) as typeof stdout.write;

    stderr.write = ((...writeArgs: Parameters<typeof stderr.write>) => {
      const [chunk] = writeArgs;
      this.config.onLog?.({ stream: "stderr", text: chunkToString(chunk) });
      return Reflect.apply(originalStderrWrite, stderr, writeArgs) as boolean;
    }) as typeof stderr.write;

    return () => {
      stdout.write = originalStdoutWrite;
      stderr.write = originalStderrWrite;
    };
  }
}

function chunkToString(chunk: unknown): string {
  return Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
}
