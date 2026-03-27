import type { Page } from "playwright";
import type { MinimalLogger } from "../logger/logger.js";

export const LIBRETTO_WORKFLOW_BRAND = Symbol.for("libretto.workflow");

export type LibrettoWorkflowContext<S = {}> = {
  session: string;
  page: Page;
  logger: MinimalLogger;
  services: S;
};

export type LibrettoWorkflowHandler<
  Input = unknown,
  Output = unknown,
  S = {},
> = (ctx: LibrettoWorkflowContext<S>, input: Input) => Promise<Output>;

export class LibrettoWorkflow<Input = unknown, Output = unknown, S = {}> {
  public readonly [LIBRETTO_WORKFLOW_BRAND] = true;
  private readonly handler: LibrettoWorkflowHandler<Input, Output, S>;

  constructor(handler: LibrettoWorkflowHandler<Input, Output, S>) {
    this.handler = handler;
  }

  async run(ctx: LibrettoWorkflowContext<S>, input: Input): Promise<Output> {
    return this.handler(ctx, input);
  }
}

export function workflow<Input = unknown, Output = unknown, S = {}>(
  handler: LibrettoWorkflowHandler<Input, Output, S>,
): LibrettoWorkflow<Input, Output, S> {
  return new LibrettoWorkflow(handler);
}
