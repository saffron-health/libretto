// Public entry for the framework-agnostic base format.
export { DomainPolicyRestricted } from "./domain-policy.js";
export type { DomainPolicyOptions } from "./domain-policy.js";
export type { BrowserTool, ToolErrorResult, ToolResult } from "./tool.js";
export type {
	BrowserProvider,
	ProviderSession,
	ProviderSessionClosed,
} from "./provider.js";
export {
	createBrowserTools,
	createBrowserToolsForPage,
} from "./create-browser-tools.js";
export type {
	BorrowedPageBrowserToolkit,
	BrowserToolkit,
	BrowserToolkitOptions,
} from "./create-browser-tools.js";
export { LocalBrowserProvider } from "./providers/local.js";
export type { LocalBrowserProviderOptions } from "./providers/local.js";
export type { OpenTool, OpenToolInput, OpenToolOutput } from "./tools/open.js";
export type { ExecTool, ExecToolInput, ExecToolOutput } from "./tools/exec.js";
export type {
	SnapshotTool,
	SnapshotToolInput,
	SnapshotToolOutput,
	SnapshotScreenshot,
} from "./tools/snapshot.js";
