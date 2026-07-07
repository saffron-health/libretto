import { transform } from "sucrase";

/**
 * Strips TypeScript annotations without transforming ES syntax, matching the
 * transform executor.sh uses. Parse errors propagate to the caller.
 */
export const stripTypeScript = (code: string): string =>
	transform(code, {
		transforms: ["typescript"],
		disableESTransforms: true,
		keepUnusedImports: true,
	}).code;
