import type { Page } from "playwright";
import type { MinimalLogger } from "../logger/logger.js";

export const LIBRETTO_WORKFLOW_BRAND = Symbol.for("libretto.workflow");

export type LibrettoWorkflowMetadata = {};

export type LibrettoWorkflowContext<S = {}> = {
	page: Page;
	logger: MinimalLogger;
	services: S;
};

export type LibrettoWorkflowHandler<Input = unknown, Output = unknown, S = {}> = (
	ctx: LibrettoWorkflowContext<S>,
	input: Input,
) => Promise<Output>;

export class LibrettoWorkflow<Input = unknown, Output = unknown, S = {}> {
	public readonly [LIBRETTO_WORKFLOW_BRAND] = true;
	public readonly metadata: LibrettoWorkflowMetadata;
	private readonly handler: LibrettoWorkflowHandler<Input, Output, S>;

	constructor(
		metadata: LibrettoWorkflowMetadata,
		handler: LibrettoWorkflowHandler<Input, Output, S>,
	) {
		this.metadata = metadata;
		this.handler = handler;
	}

	async run(ctx: LibrettoWorkflowContext<S>, input: Input): Promise<Output> {
		return this.handler(ctx, input);
	}
}

export function workflow<Input = unknown, Output = unknown, S = {}>(
	metadata: LibrettoWorkflowMetadata,
	handler: LibrettoWorkflowHandler<Input, Output, S>,
): LibrettoWorkflow<Input, Output, S> {
	return new LibrettoWorkflow(metadata, handler);
}
