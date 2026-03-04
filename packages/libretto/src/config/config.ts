/**
 * Runtime configuration for libretto.
 *
 * Can be set via runner config or environment variables.
 * Runner config takes precedence over env vars.
 */

let _debugOverride: boolean | undefined;
let _dryRunOverride: boolean | undefined;

export function setDebugMode(value: boolean): void {
	_debugOverride = value;
}

export function setDryRun(value: boolean): void {
	_dryRunOverride = value;
}

export function isDebugMode(): boolean {
	if (_debugOverride !== undefined) return _debugOverride;
	return process.env.LIBRETTO_DEBUG === "true";
}

export function isDryRun(): boolean {
	if (_dryRunOverride !== undefined) return _dryRunOverride;

	const explicit = process.env.LIBRETTO_DRY_RUN;
	if (explicit !== undefined) {
		return explicit === "true";
	}

	return process.env.NODE_ENV === "development";
}

export function shouldPauseBeforeMutation(): boolean {
	return isDryRun() && isDebugMode();
}
