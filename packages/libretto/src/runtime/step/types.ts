import type { Page } from "playwright";
import type { LoggerApi } from "../../shared/logger/logger.js";
import type { LLMClient } from "../../shared/llm/types.js";

export type StepContext = {
	page: Page;
	logger: LoggerApi;
	config: {
		dryRun: boolean;
		debug: boolean;
		logDir: string;
	};
};

export type RecoveryHandler = (ctx: {
	page: Page;
	logger: LoggerApi;
}) => Promise<void>;

export type StepOptions = {
	/**
	 * Behavior in dry-run mode:
	 * - "execute": always run, even in dry-run (e.g., login steps)
	 * - "skip": skip entirely in dry-run
	 * - "simulate": call the simulate function instead
	 *
	 * Defaults to "skip".
	 */
	dryRun?: "execute" | "skip" | "simulate";

	/**
	 * Function to call instead of the handler when dryRun is "simulate".
	 */
	simulate?: (ctx: { logger: LoggerApi }) => Promise<any>;

	/**
	 * Custom recovery handlers keyed by name.
	 * These run after built-in popup recovery on failure.
	 */
	recovery?: Record<string, RecoveryHandler>;
};

export type StepHandler = (ctx: StepContext) => Promise<any>;

export type Step = {
	name: string;
	handler: StepHandler;
	options: Required<Pick<StepOptions, "dryRun">> & Omit<StepOptions, "dryRun">;
};

export type RunnerConfig = {
	llmClient?: LLMClient;
	dryRun?: boolean;
	debug?: boolean;
	sessionName?: string;
	logDir?: string;
};

export type StepHistoryEntry = {
	name: string;
	status: "completed" | "failed" | "skipped" | "simulated";
	duration: number;
};

export type DebugBundle = {
	timestamp: string;
	step: string;
	error: string;
	stacktrace: string;
	screenshotPath: string;
	domPath: string;
	logPath: string;
	stepHistory: StepHistoryEntry[];
	pageUrl: string;
	visualizationEnabled?: boolean;
};
