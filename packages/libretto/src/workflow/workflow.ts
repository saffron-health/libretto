import type { Browser, BrowserContext, Page } from "playwright";

export const LIBRETTO_WORKFLOW_BRAND = Symbol.for("libretto.workflow");

export type LibrettoAuthProfile = {
	type: "local";
	domain: string;
};

export type LibrettoWorkflowMetadata = {
	authProfile?: LibrettoAuthProfile;
};

export type LibrettoWorkflowContext = {
	logger: unknown;
	page: Page;
	context: BrowserContext;
	browser: Browser;
	session: string;
	integrationPath: string;
	exportName: string;
	headless: boolean;
};

export type LibrettoWorkflowHandler<Input = unknown, Output = unknown> = (
	ctx: LibrettoWorkflowContext,
	input: Input,
) => Promise<Output>;

export class LibrettoWorkflow<Input = unknown, Output = unknown> {
	public readonly [LIBRETTO_WORKFLOW_BRAND] = true;
	public readonly metadata: LibrettoWorkflowMetadata;
	private readonly handler: LibrettoWorkflowHandler<Input, Output>;

	constructor(
		metadata: LibrettoWorkflowMetadata,
		handler: LibrettoWorkflowHandler<Input, Output>,
	) {
		this.metadata = metadata;
		this.handler = handler;
	}

	async run(ctx: LibrettoWorkflowContext, input: Input): Promise<Output> {
		return this.handler(ctx, input);
	}
}

export function workflow<Input = unknown, Output = unknown>(
	metadata: LibrettoWorkflowMetadata,
	handler: LibrettoWorkflowHandler<Input, Output>,
): LibrettoWorkflow<Input, Output> {
	return new LibrettoWorkflow(metadata, handler);
}
