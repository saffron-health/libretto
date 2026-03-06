/**
 * Runtime configuration for libretto.
 *
 * Values are derived from environment variables only.
 */

export function isDebugMode(): boolean {
	return process.env.LIBRETTO_DEBUG === "true";
}

export function isDryRun(): boolean {
	const explicit = process.env.LIBRETTO_DRY_RUN;
	if (explicit !== undefined) {
		return explicit === "true";
	}

	return process.env.NODE_ENV === "development";
}

export function shouldPauseBeforeMutation(): boolean {
	return isDryRun() && isDebugMode();
}
