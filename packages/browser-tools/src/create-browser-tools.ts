import type { BrowserProvider } from "./provider.js";
import { SessionRegistry } from "./session-registry.js";
import type { ExecTool } from "./tools/exec.js";
import { createExecTool } from "./tools/exec.js";
import type { OpenTool } from "./tools/open.js";
import { createOpenTool } from "./tools/open.js";
import type { SnapshotTool } from "./tools/snapshot.js";
import { createSnapshotTool } from "./tools/snapshot.js";

export interface BrowserToolkit {
	tools: {
		browser_open: OpenTool;
		browser_exec: ExecTool;
		browser_snapshot: SnapshotTool;
	};
	/** Closes every session opened through this toolkit. */
	dispose(): Promise<void>;
}

/**
 * Framework-agnostic factory — returns base {@link BrowserTool} objects.
 * Framework entry points live under src/adapters/ (e.g. adapters/ai-sdk).
 */
export function createBrowserTools(provider: BrowserProvider): BrowserToolkit {
	const registry = new SessionRegistry(provider);
	return {
		tools: {
			browser_open: createOpenTool(registry),
			browser_exec: createExecTool(registry),
			browser_snapshot: createSnapshotTool(registry),
		},
		dispose: () => registry.dispose(),
	};
}
