import type { BrowserProvider } from "./provider.js";
import { SessionRegistry } from "./session-registry.js";
import type { ExecTool } from "./tools/exec.js";
import { createExecTool } from "./tools/exec.js";
import type { OpenTool } from "./tools/open.js";
import { createOpenTool } from "./tools/open.js";

export interface BrowserToolkit {
	tools: {
		browser_open: OpenTool;
		browser_exec: ExecTool;
	};
	/** Closes every session opened through this toolkit. */
	dispose(): Promise<void>;
}

/**
 * Framework-agnostic factory — returns base {@link BrowserTool} objects.
 * Framework entry points wrap this: `createAiSdkBrowserTools`, `createFlueBrowserTools`, …
 */
export function createBrowserTools(provider: BrowserProvider): BrowserToolkit {
	const registry = new SessionRegistry(provider);
	return {
		tools: {
			browser_open: createOpenTool(registry),
			browser_exec: createExecTool(registry),
		},
		dispose: () => registry.dispose(),
	};
}
