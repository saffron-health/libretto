import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Framework-agnostic base tool format. Framework entry points (ai-sdk, flue,
 * ...) adapt this shape into their own tool formats. `inputSchema` is typed as
 * Standard Schema so the public contract names no validator; schemas are
 * authored in zod internally.
 */
export interface BrowserTool<Input = unknown, Output = unknown> {
	/** Prefixed name as exposed to the agent, e.g. `browser_open`. */
	name: string;
	description: string;
	inputSchema: StandardSchemaV1<Input>;
	execute(input: Input): Promise<ToolResult<Output>>;
}

/**
 * Every tool returns the same envelope: `{ ok: true, ...payload }` on
 * success, `{ ok: false, error }` for model-fixable failures (bad session ID,
 * agent code that throws). Host-level failures throw. Domain policy violations
 * throw {@link DomainPolicyRestricted} so clients can inspect and render the
 * configured policy and attempted URL.
 */
export interface ToolErrorResult {
	ok: false;
	error: string;
	stdout?: string;
	stderr?: string;
}

export type ToolResult<T> = ({ ok: true } & T) | ToolErrorResult;
