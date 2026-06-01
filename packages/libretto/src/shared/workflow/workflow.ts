import type { Page } from "playwright";
import { z } from "zod";
import {
  createFallbackPage,
  type PageFallback,
} from "../../runtime/recovery/page-fallbacks.js";

export const LIBRETTO_WORKFLOW_BRAND = Symbol.for("libretto.workflow");

export type LibrettoWorkflowContext = {
  session: string;
  page: Page;
};

export type LibrettoWorkflowHandler<Input = unknown, Output = unknown> = (
  ctx: LibrettoWorkflowContext,
  input: Input,
) => Promise<Output>;

export type LibrettoWorkflowSchemas<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
> = {
  input: InputSchema;
  output: OutputSchema;
};

export type LibrettoWorkflowOptions<
  Input = unknown,
  Output = unknown,
  InputSchema extends z.ZodType = z.ZodType<Input>,
  OutputSchema extends z.ZodType = z.ZodType<Output>,
> = {
  schemas?: LibrettoWorkflowSchemas<InputSchema, OutputSchema>;
  pageFallback?: PageFallback;
  handler: LibrettoWorkflowHandler<Input, Output>;
};

// Thrown when input fails Zod validation. The runner surfaces `.message`
// directly to the user, so we format issues into a single readable block.
export class LibrettoWorkflowInputError extends Error {
  public readonly workflowName: string;
  public readonly zodError: z.ZodError;

  constructor(workflowName: string, zodError: z.ZodError) {
    super(formatZodErrorMessage(workflowName, zodError));
    this.name = "LibrettoWorkflowInputError";
    this.workflowName = workflowName;
    this.zodError = zodError;
  }
}

function formatZodErrorMessage(
  workflowName: string,
  zodError: z.ZodError,
): string {
  const lines = zodError.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  - ${path}: ${issue.message}`;
  });
  return [
    `Invalid input for workflow "${workflowName}":`,
    ...lines,
  ].join("\n");
}

function parseWorkflowInput<InputSchema extends z.ZodType>(
  workflowName: string,
  inputSchema: InputSchema | undefined,
  input: unknown,
): z.infer<InputSchema> {
  if (!inputSchema) return input as z.infer<InputSchema>;

  const result = inputSchema.safeParse(input);
  if (!result.success) {
    throw new LibrettoWorkflowInputError(workflowName, result.error);
  }
  return result.data;
}

export type WorkflowInputValidator = {
  readonly name: string;
  readonly inputSchema?: z.ZodType;
};

export function validateWorkflowInput(
  workflow: WorkflowInputValidator,
  input: unknown,
): void {
  parseWorkflowInput(workflow.name, workflow.inputSchema, input);
}

export class LibrettoWorkflow<
  InputSchema extends z.ZodType = z.ZodType<unknown>,
  OutputSchema extends z.ZodType = z.ZodType<unknown>,
> {
  public readonly [LIBRETTO_WORKFLOW_BRAND] = true;
  public readonly name: string;
  // Optional so the legacy 2-arg `workflow(name, handler)` form still works
  // for deployments that were built before Zod schemas were a thing.
  public readonly inputSchema?: InputSchema;
  // Metadata only — `run()` validates `input` against `inputSchema` but does
  // not parse the handler's return value. The hosted platform serializes
  // this schema to JSON Schema at build time and exposes it via
  // /v1/workflows/get so API consumers know the workflow's output shape.
  public readonly outputSchema?: OutputSchema;
  public readonly pageFallback?: PageFallback;
  private readonly handler: LibrettoWorkflowHandler<
    z.infer<InputSchema>,
    z.infer<OutputSchema>
  >;

  constructor(
    name: string,
    schemas: LibrettoWorkflowSchemas<InputSchema, OutputSchema> | undefined,
    handler: LibrettoWorkflowHandler<
      z.infer<InputSchema>,
      z.infer<OutputSchema>
    >,
    options?: { pageFallback?: PageFallback },
  ) {
    this.name = name;
    this.inputSchema = schemas?.input;
    this.outputSchema = schemas?.output;
    this.pageFallback = options?.pageFallback;
    this.handler = handler;
  }

  async run(
    ctx: LibrettoWorkflowContext,
    input: unknown,
  ): Promise<z.infer<OutputSchema>> {
    const parsed = parseWorkflowInput(this.name, this.inputSchema, input);
    const workflowContext =
      !this.pageFallback
        ? ctx
        : {
            ...ctx,
            page: createFallbackPage(ctx.page, {
              fallback: this.pageFallback,
            }),
          };
    return this.handler(workflowContext, parsed);
  }
}

export type ExportedLibrettoWorkflow = {
  readonly [LIBRETTO_WORKFLOW_BRAND]: true;
  readonly name: string;
  readonly inputSchema?: z.ZodType;
  readonly outputSchema?: z.ZodType;
  readonly pageFallback?: PageFallback;
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

function collectWorkflowsOrThrow(
  values: Iterable<unknown>,
): ExportedLibrettoWorkflow[] {
  const workflowsByName = new Map<string, ExportedLibrettoWorkflow>();

  for (const value of values) {
    addWorkflowOrThrow(workflowsByName, value);
  }

  return [...workflowsByName.values()];
}

export function getWorkflowsFromModuleExports(
  moduleExports: WorkflowModuleExports,
): ExportedLibrettoWorkflow[] {
  const discoveredValues: unknown[] = [];

  for (const [exportName, value] of Object.entries(moduleExports)) {
    if (exportName === "workflows" && value && typeof value === "object") {
      // Support both `export const workflows = workflow(...)` and
      // `export const workflows = { myWorkflow }`.
      if (isLibrettoWorkflow(value)) {
        discoveredValues.push(value);
      } else {
        discoveredValues.push(...Object.values(value as Record<string, unknown>));
      }
      continue;
    }

    discoveredValues.push(value);
  }

  return collectWorkflowsOrThrow(discoveredValues);
}

export function getDefaultWorkflowFromModuleExports(
  moduleExports: WorkflowModuleExports,
): ExportedLibrettoWorkflow | null {
  return isLibrettoWorkflow(moduleExports.default) ? moduleExports.default : null;
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

// Recommended 3-arg form: pass Zod schemas so input is validated at run time
// and the hosted platform can expose typed I/O metadata via /v1/workflows/get.
export function workflow<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
>(
  name: string,
  schemas: LibrettoWorkflowSchemas<InputSchema, OutputSchema>,
  handler: LibrettoWorkflowHandler<
    z.infer<InputSchema>,
    z.infer<OutputSchema>
  >,
): LibrettoWorkflow<InputSchema, OutputSchema>;

export function workflow<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
>(
  name: string,
  options: LibrettoWorkflowOptions<
    z.infer<InputSchema>,
    z.infer<OutputSchema>,
    InputSchema,
    OutputSchema
  > & {
    schemas: LibrettoWorkflowSchemas<InputSchema, OutputSchema>;
  },
): LibrettoWorkflow<InputSchema, OutputSchema>;

export function workflow<Input = unknown, Output = unknown>(
  name: string,
  options: LibrettoWorkflowOptions<Input, Output>,
): LibrettoWorkflow<z.ZodType<Input>, z.ZodType<Output>>;

// Legacy 2-arg form kept so deployments built before Zod schemas existed
// continue to load. New code should always pass schemas.
export function workflow<Input = unknown, Output = unknown>(
  name: string,
  handler: LibrettoWorkflowHandler<Input, Output>,
): LibrettoWorkflow<z.ZodType<Input>, z.ZodType<Output>>;

export function workflow(
  name: string,
  schemasOrHandler:
    | LibrettoWorkflowSchemas<z.ZodType, z.ZodType>
    | LibrettoWorkflowOptions
    | LibrettoWorkflowHandler,
  maybeHandler?: LibrettoWorkflowHandler,
): LibrettoWorkflow {
  if (typeof schemasOrHandler === "function") {
    return new LibrettoWorkflow(name, undefined, schemasOrHandler);
  }
  if ("handler" in schemasOrHandler) {
    return new LibrettoWorkflow(
      name,
      schemasOrHandler.schemas,
      schemasOrHandler.handler,
      { pageFallback: schemasOrHandler.pageFallback },
    );
  }
  if (!maybeHandler) {
    throw new Error(
      `workflow("${name}") called with schemas but no handler. Pass the handler as the third argument.`,
    );
  }
  return new LibrettoWorkflow(name, schemasOrHandler, maybeHandler);
}
