import type { Page } from "playwright";
import { isDebugMode } from "../config/config.js";

export type DebugPauseOptions = {
	/** Whether pause mode is enabled for this call. Defaults to env-based debug mode. */
	enabled?: boolean;
	/** Session name to include in pause metadata. Defaults to "libretto". */
	sessionName?: string;
};

export type DebugPauseDetails = {
	sessionName: string;
	pausedAt: string;
	url: string;
};

function getSessionName(options?: DebugPauseOptions): string {
	return options?.sessionName ?? "libretto";
}

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
 * When enabled, this throws a typed signal that supervisors can intercept.
 */
export async function debugPause(
	page: Page,
	options?: DebugPauseOptions,
): Promise<void> {
	const enabled = options?.enabled ?? isDebugMode();
	if (!enabled) return;

	const url = page.url();
	const details: DebugPauseDetails = {
		sessionName: getSessionName(options),
		pausedAt: new Date().toISOString(),
		url,
	};

	console.log(`[debugPause] Paused at ${url}`);
	console.log("[debugPause] Signaling pause to supervisor...");
	throw new DebugPauseSignal(details);
}
