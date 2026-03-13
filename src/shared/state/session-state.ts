import { z } from "zod";

export const SESSION_STATE_VERSION = 1;
export const SessionProviderSchema = z.enum(["local", "kernel"]);

export const SessionStatusSchema = z.enum([
	"active",
	"paused",
	"completed",
	"failed",
	"exited",
]);
const SessionStateBaseSchema = z.object({
	version: z.literal(SESSION_STATE_VERSION),
	pid: z.number().int(),
	session: z.string().min(1),
	startedAt: z.string().datetime({ offset: true }),
	status: SessionStatusSchema.optional(),
});
const LocalSessionStateBaseSchema = SessionStateBaseSchema.extend({
	port: z.number().int().min(0).max(65535),
});
const ExplicitLocalSessionStateFileSchema = LocalSessionStateBaseSchema.extend({
	provider: z.literal("local"),
});
const LegacyLocalSessionStateFileSchema = LocalSessionStateBaseSchema.extend({
	provider: z.undefined().optional(),
});
const KernelSessionStateFileSchema = SessionStateBaseSchema.extend({
	provider: z.literal("kernel"),
	cdpWsUrl: z.string().url(),
	sessionId: z.string().min(1),
});

export const SessionStateFileSchema = z.union([
	LegacyLocalSessionStateFileSchema,
	ExplicitLocalSessionStateFileSchema,
	KernelSessionStateFileSchema,
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type SessionProvider = z.infer<typeof SessionProviderSchema>;
export type SessionStateFile = z.infer<typeof SessionStateFileSchema>;
export type LocalSessionState = Omit<
	z.infer<typeof ExplicitLocalSessionStateFileSchema>,
	"version"
>;
export type KernelSessionState = Omit<
	z.infer<typeof KernelSessionStateFileSchema>,
	"version"
>;
export type SessionState = LocalSessionState | KernelSessionState;

function formatIssues(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.join(".") || "root";
			return `${path}: ${issue.message}`;
		})
		.join("; ");
}

export function parseSessionStateData(
	rawState: unknown,
	source: string,
): SessionState {
	const parsed = SessionStateFileSchema.safeParse(rawState);
	if (!parsed.success) {
		throw new Error(`Session state at ${source} is invalid: ${formatIssues(parsed.error)}`);
	}

	if (parsed.data.provider === "kernel") {
		const { version: _version, ...state } = parsed.data;
		return state;
	}

	return {
		provider: "local",
		session: parsed.data.session,
		port: parsed.data.port,
		pid: parsed.data.pid,
		startedAt: parsed.data.startedAt,
		status: parsed.data.status,
	};
}

export function parseSessionStateContent(
	content: string,
	source: string,
): SessionState {
	let rawState: unknown;
	try {
		rawState = JSON.parse(content);
	} catch (error) {
		throw new Error(
			`Session state at ${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	return parseSessionStateData(rawState, source);
}

export function serializeSessionState(state: SessionState): SessionStateFile {
	if (state.provider === "kernel") {
		return KernelSessionStateFileSchema.parse({
			version: SESSION_STATE_VERSION,
			...state,
		});
	}

	return ExplicitLocalSessionStateFileSchema.parse({
		version: SESSION_STATE_VERSION,
		...state,
	});
}

export function isKernelSessionState(
	state: SessionState,
): state is KernelSessionState {
	return state.provider === "kernel";
}

export function isLocalSessionState(
	state: SessionState,
): state is LocalSessionState {
	return state.provider === "local";
}

export function getSessionOwnerPid(state: SessionState): number {
	return state.pid;
}

export function getSessionConnectionEndpoint(state: SessionState): string {
	return state.provider === "kernel"
		? state.cdpWsUrl
		: `http://127.0.0.1:${state.port}`;
}
