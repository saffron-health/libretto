import type { BrowserProvider } from "./provider.js";
import { SessionRegistry } from "./session-registry.js";
import type { CloseTool } from "./tools/close.js";
import { createCloseTool } from "./tools/close.js";
import type { ConnectTool } from "./tools/connect.js";
import { createConnectTool } from "./tools/connect.js";
import type { ExecTool } from "./tools/exec.js";
import { createExecTool } from "./tools/exec.js";
import type { OpenTool } from "./tools/open.js";
import { createOpenTool } from "./tools/open.js";
import type { SnapshotTool } from "./tools/snapshot.js";
import { createSnapshotTool } from "./tools/snapshot.js";
import type { StatusTool } from "./tools/status.js";
import { createStatusTool } from "./tools/status.js";

export interface BrowserToolkit {
	tools: {
		browser_open: OpenTool;
		browser_exec: ExecTool;
		browser_snapshot: SnapshotTool;
		browser_status: StatusTool;
		browser_close: CloseTool;
		browser_connect: ConnectTool;
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
			browser_status: createStatusTool(registry),
			browser_close: createCloseTool(registry),
			browser_connect: createConnectTool(registry),
		},
		dispose: () => registry.dispose(),
	};
}
