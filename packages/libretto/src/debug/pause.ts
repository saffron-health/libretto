import type { Page } from "playwright";
export type DebugPauseContext = {
	page: Page;
	session: string;
};

export type DebugPauseDetails = {
	sessionName: string;
	pausedAt: string;
	url: string;
};

export class DebugPauseSignal extends Error {
	public readonly details: DebugPauseDetails;

	constructor(details: DebugPauseDetails) {
		super(`Workflow paused at ${details.url}`);
		this.name = "DebugPauseSignal";
		this.details = details;
	}
}

export function isDebugPauseSignal(error: unknown): error is DebugPauseSignal {
	if (!error || typeof error !== "object") return false;
	const candidate = error as {
		name?: unknown;
		details?: {
			sessionName?: unknown;
			pausedAt?: unknown;
			url?: unknown;
		};
	};
	if (candidate.name !== "DebugPauseSignal") return false;
	return (
		typeof candidate.details?.sessionName === "string" &&
		typeof candidate.details?.pausedAt === "string" &&
		typeof candidate.details?.url === "string"
	);
}

/**
 * Signals a workflow pause to the caller.
 * This always throws a typed signal that supervisors can intercept.
 */
export async function debugPause(context: DebugPauseContext): Promise<never> {
	const url = context.page.url();
	const details: DebugPauseDetails = {
		sessionName: context.session,
		pausedAt: new Date().toISOString(),
		url,
	};

	console.log(`[debugPause] Paused at ${url}`);
	console.log("[debugPause] Signaling pause to supervisor...");
	throw new DebugPauseSignal(details);
}
