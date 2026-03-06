import { z } from "zod";

export const SESSION_STATE_VERSION = 1;

export const SessionModeSchema = z.enum(["read-only", "interactive"]);
export const SessionStateFileSchema = z.object({
	version: z.literal(SESSION_STATE_VERSION),
	port: z.number().int().min(0).max(65535),
	pid: z.number().int(),
	session: z.string().min(1),
	runId: z.string().min(1),
	startedAt: z.string().datetime({ offset: true }),
	mode: SessionModeSchema.optional(),
});

export type SessionMode = z.infer<typeof SessionModeSchema>;
export type SessionStateFile = z.infer<typeof SessionStateFileSchema>;
export type SessionState = Omit<SessionStateFile, "version">;

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

	const { version: _version, ...state } = parsed.data;
	return state;
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
	return SessionStateFileSchema.parse({
		version: SESSION_STATE_VERSION,
		...state,
	});
}
