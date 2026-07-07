/** Format an unknown thrown value for agent-facing tool error strings. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Like {@link errorMessage} but prefixes the error name when available
 * (e.g. `TimeoutError: ...`), which helps agents recognize Playwright failures.
 */
export function errorMessageWithName(error: unknown): string {
	if (error instanceof Error) return `${error.name}: ${error.message}`;
	return String(error);
}
