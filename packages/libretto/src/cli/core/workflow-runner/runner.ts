import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createIpcPeer, type IpcPeer } from "../../../shared/ipc/ipc.js";
import { createChildProcessIpcTransport } from "../../../shared/ipc/child-process-transport.js";
import type { DaemonWorkflowConfig } from "../daemon/config.js";

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

type WorkflowExitedState = {
  state: "exited";
  exitedAt: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  message: string;
};

export type WorkflowOutcome =
  | WorkflowPausedState
  | WorkflowFinishedState
  | WorkflowExitedState;

export type WorkflowChildToParentApi = {
  paused(args: Omit<WorkflowPausedState, "state">): Promise<void>;
  finished(args: WorkflowFinishedArgs): void;
};

export type WorkflowParentToChildApi = {
  shutdown(args: { reason: string }): void;
};

export type WorkflowStatus =
  | { state: "idle" }
  | { state: "running" }
  | WorkflowOutcome;

type WorkflowOutputEvent = {
  stream: "stdout" | "stderr";
  text: string;
};

type WorkflowRunnerOptions = {
  session: string;
  workflow: DaemonWorkflowConfig;
  cdpEndpoint: string;
  pageId?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onOutput?: (event: WorkflowOutputEvent) => void;
  onOutcome?: (outcome: WorkflowOutcome) => void;
};

type PendingPause = {
  resolve(): void;
};

export class WorkflowRunner {
  private child: ChildProcess | undefined;
  private ipc: IpcPeer<WorkflowParentToChildApi> | undefined;
  private status: WorkflowStatus = { state: "idle" };
  private pendingPause: PendingPause | undefined;

  constructor(private readonly options: WorkflowRunnerOptions) {}

  start(): void {
    if (this.child) {
      throw new Error("Workflow runner has already started.");
    }

    const childEntryPath = fileURLToPath(new URL("./child.js", import.meta.url));
    const require = createRequire(import.meta.url);
    const tsxCliPath = require.resolve("tsx/cli");

    const child = spawn(
      process.execPath,
      [tsxCliPath, ...this.getChildArgs(childEntryPath)],
      {
        cwd: this.options.cwd,
        env: this.options.env,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );

    this.child = child;
    this.status = { state: "running" };
    this.ipc = createIpcPeer<
      WorkflowParentToChildApi,
      WorkflowChildToParentApi
    >(createChildProcessIpcTransport(child), {
      paused: (args) => this.handlePaused(args),
      finished: (args) => this.handleFinished(args),
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      this.options.onOutput?.({ stream: "stdout", text: String(chunk) });
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.options.onOutput?.({ stream: "stderr", text: String(chunk) });
    });
    child.once("error", (error) => this.handleSpawnError(error));
    child.once("exit", (code, signal) => this.handleExit(code, signal));
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

  async shutdown(reason: string): Promise<void> {
    await this.ipc?.call.shutdown({ reason });
  }

  private handlePaused(
    args: Parameters<WorkflowChildToParentApi["paused"]>[0],
  ): Promise<void> {
    if (this.pendingPause) {
      throw new Error("Workflow is already paused.");
    }

    this.emitEvent({ state: "paused", ...args });

    return new Promise<void>((resolve) => {
      this.pendingPause = { resolve };
    });
  }

  private handleFinished(
    args: Parameters<WorkflowChildToParentApi["finished"]>[0],
  ): void {
    this.resolvePendingPause();
    this.emitEvent({ state: "finished", ...args });
  }

  private handleSpawnError(error: Error): void {
    if (this.isTerminal()) return;

    this.emitEvent({
      state: "finished",
      result: "failed",
      message: error.message,
      phase: "setup",
    });
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.ipc?.destroy();

    if (this.status.state === "idle" || this.isTerminal()) {
      return;
    }

    this.resolvePendingPause();

    const exitedAt = new Date().toISOString();
    const status =
      code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
    const message = `Workflow child exited before reporting an outcome (${status}).`;
    this.emitEvent({
      state: "exited",
      exitedAt,
      code,
      signal,
      message,
    });
  }

  private emitEvent(event: WorkflowOutcome): void {
    this.status = event;
    this.options.onOutcome?.(event);
  }

  private resolvePendingPause(): void {
    const pendingPause = this.pendingPause;
    if (!pendingPause) return;

    this.pendingPause = undefined;
    pendingPause.resolve();
  }

  private isTerminal(): boolean {
    return this.status.state === "finished" || this.status.state === "exited";
  }

  private getChildArgs(childEntryPath: string): string[] {
    return [
      ...(this.options.workflow.tsconfigPath
        ? ["--tsconfig", this.options.workflow.tsconfigPath]
        : []),
      childEntryPath,
      JSON.stringify({
        session: this.options.session,
        workflow: this.options.workflow,
        cdpEndpoint: this.options.cdpEndpoint,
        pageId: this.options.pageId,
      }),
    ];
  }
}
