/** Format an unknown thrown value for agent-facing tool error strings. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
