import type { Page } from "playwright";
import type { MinimalLogger } from "../logger/logger.js";
import type { WorkflowStorageContext } from "./storage.js";

export const LIBRETTO_WORKFLOW_BRAND = Symbol.for("libretto.workflow");

export type LibrettoWorkflowContext = {
  session: string;
  page: Page;
  logger: MinimalLogger;
  storage: WorkflowStorageContext;
  credentials?: Record<string, unknown>;
};

export type LibrettoWorkflowHandler<Input = unknown, Output = unknown> = (
  ctx: LibrettoWorkflowContext,
  input: Input,
) => Promise<Output>;

export class LibrettoWorkflow<Input = unknown, Output = unknown> {
  public readonly [LIBRETTO_WORKFLOW_BRAND] = true;
  public readonly name: string;
  private readonly handler: LibrettoWorkflowHandler<Input, Output>;

  constructor(
    name: string,
    handler: LibrettoWorkflowHandler<Input, Output>,
  ) {
    this.name = name;
    this.handler = handler;
  }

  async run(ctx: LibrettoWorkflowContext, input: Input): Promise<Output> {
    return this.handler(ctx, input);
  }
}

export type ExportedLibrettoWorkflow = {
  readonly [LIBRETTO_WORKFLOW_BRAND]: true;
  readonly name: string;
  run: (ctx: LibrettoWorkflowContext, input: unknown) => Promise<unknown>;
};

type WorkflowModuleExports = Record<string, unknown>;

// Use the workflow brand instead of `instanceof` so imported workflows are
// still recognized after loading the integration module dynamically.
export function isLibrettoWorkflow(
  value: unknown,
): value is ExportedLibrettoWorkflow {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<PropertyKey, unknown>;
  return (
    candidate[LIBRETTO_WORKFLOW_BRAND] === true &&
    typeof candidate.name === "string" &&
    typeof candidate.run === "function"
  );
}

function addWorkflowOrThrow(
  workflowsByName: Map<string, ExportedLibrettoWorkflow>,
  value: unknown,
): void {
  if (!isLibrettoWorkflow(value)) return;

  // Re-exporting the same workflow object is fine, but two distinct workflow
  // instances cannot claim the same runtime name.
  const existing = workflowsByName.get(value.name);
  if (existing && existing !== value) {
    throw new Error(
      `Duplicate workflow name: "${value.name}". Each workflow() call must use a unique name.`,
    );
  }

  workflowsByName.set(value.name, value);
}

export function getWorkflowsFromModuleExports(
  moduleExports: WorkflowModuleExports,
): ExportedLibrettoWorkflow[] {
  const workflowsByName = new Map<string, ExportedLibrettoWorkflow>();

  for (const [exportName, value] of Object.entries(moduleExports)) {
    if (exportName === "workflows" && value && typeof value === "object") {
      // Support both `export const workflows = workflow(...)` and
      // `export const workflows = { myWorkflow }`.
      if (isLibrettoWorkflow(value)) {
        addWorkflowOrThrow(workflowsByName, value);
      } else {
        for (const nestedValue of Object.values(
          value as Record<string, unknown>,
        )) {
          addWorkflowOrThrow(workflowsByName, nestedValue);
        }
      }
      continue;
    }

    addWorkflowOrThrow(workflowsByName, value);
  }

  return [...workflowsByName.values()];
}

export function getWorkflowFromModuleExports(
  moduleExports: WorkflowModuleExports,
  workflowName: string,
): ExportedLibrettoWorkflow | null {
  for (const workflow of getWorkflowsFromModuleExports(moduleExports)) {
    if (workflow.name === workflowName) {
      return workflow;
    }
  }
  return null;
}

export function workflow<Input = unknown, Output = unknown>(
  name: string,
  handler: LibrettoWorkflowHandler<Input, Output>,
): LibrettoWorkflow<Input, Output> {
  return new LibrettoWorkflow(name, handler);
}
