import type { Page } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunnerConfig, Step, StepHistoryEntry, DebugBundle } from "./types.js";
import { Logger } from "../logger/logger.js";
import { createFileLogSink, prettyConsoleSink } from "../logger/sinks.js";
import type { LoggerApi } from "../logger/logger.js";
import { setDebugMode, setDryRun } from "../config/config.js";
import { debugPause } from "../debug/pause.js";
import { attemptWithRecovery } from "../recovery/recovery.js";

export type Runner = {
	run: (page: Page, steps: Step[]) => Promise<void>;
};

/**
 * Creates a step runner that executes a sequence of steps with logging,
 * recovery, dry-run support, and debug bundle generation.
 */
export function createRunner(config: RunnerConfig = {}): Runner {
	const {
		llmClient,
		dryRun = false,
		debug = false,
		logDir = join(process.cwd(), "tmp", "libretto", "logs"),
	} = config;

	// Set global config overrides
	setDebugMode(debug);
	setDryRun(dryRun);

	return {
		run: async (page: Page, steps: Step[]) => {
			mkdirSync(logDir, { recursive: true });

			const logPath = join(logDir, "session.log");
			const logger = new Logger()
				.withSink(createFileLogSink({ filePath: logPath }))
				.withSink(prettyConsoleSink);

			const stepHistory: StepHistoryEntry[] = [];

			logger.info("runner:start", {
				totalSteps: steps.length,
				dryRun,
				debug,
				logDir,
			});

			for (const step of steps) {
				const stepLogger = logger.withScope(`step:${step.name}`);
				const startTime = Date.now();

				// Dry-run handling
				if (dryRun && step.options.dryRun !== "execute") {
					if (step.options.dryRun === "skip") {
						stepLogger.info("skipped (dry-run)");
						stepHistory.push({
							name: step.name,
							status: "skipped",
							duration: 0,
						});
						continue;
					}

					if (step.options.dryRun === "simulate" && step.options.simulate) {
						stepLogger.info("simulating (dry-run)");
						try {
							await step.options.simulate({ logger: stepLogger });
						} catch (simError) {
							stepLogger.warn("simulate failed", { error: simError });
						}
						stepHistory.push({
							name: step.name,
							status: "simulated",
							duration: Date.now() - startTime,
						});
						continue;
					}

					// simulate without a simulate fn — just skip
					stepLogger.info("skipped (dry-run, no simulate fn)");
					stepHistory.push({
						name: step.name,
						status: "skipped",
						duration: 0,
					});
					continue;
				}

				// Take start screenshot
				await captureScreenshot(page, join(logDir, `${step.name}-start.png`), stepLogger);
				stepLogger.info("start");

				try {
					// First attempt with built-in popup recovery
					await attemptWithRecovery(
						page,
						() => step.handler({ page, logger: stepLogger, config: { dryRun, debug, logDir } }),
						stepLogger,
						llmClient,
					);

					stepHistory.push({
						name: step.name,
						status: "completed",
						duration: Date.now() - startTime,
					});
					stepLogger.info("end", { status: "completed", duration: Date.now() - startTime });
				} catch (firstError) {
					// Try custom recovery handlers
					let recovered = false;
					const customRecovery = step.options.recovery ?? {};

					for (const [recoveryName, recoveryHandler] of Object.entries(customRecovery)) {
						try {
							stepLogger.info(`trying custom recovery: ${recoveryName}`);
							await recoveryHandler({ page, logger: stepLogger });

							// Retry the step after custom recovery
							await step.handler({ page, logger: stepLogger, config: { dryRun, debug, logDir } });
							recovered = true;

							stepHistory.push({
								name: step.name,
								status: "completed",
								duration: Date.now() - startTime,
							});
							stepLogger.info("end", {
								status: "completed",
								recoveredBy: recoveryName,
								duration: Date.now() - startTime,
							});
							break;
						} catch {
							stepLogger.warn(`custom recovery "${recoveryName}" failed`);
						}
					}

					if (!recovered) {
						stepHistory.push({
							name: step.name,
							status: "failed",
							duration: Date.now() - startTime,
						});

						// Generate debug bundle
						const bundle = await generateDebugBundle(
							page,
							step.name,
							firstError,
							logDir,
							logPath,
							stepHistory,
							stepLogger,
						);

						stepLogger.info("step:debug-bundle", { path: bundle.bundlePath });

						// Pause for debugging
						await debugPause(page, { signalDir: join(logDir, "..") });

						throw firstError;
					}
				}

				// Take end screenshot
				await captureScreenshot(page, join(logDir, `${step.name}-end.png`), stepLogger);
			}

			logger.info("runner:complete", {
				totalSteps: steps.length,
				completed: stepHistory.filter((s) => s.status === "completed").length,
				skipped: stepHistory.filter((s) => s.status === "skipped").length,
				simulated: stepHistory.filter((s) => s.status === "simulated").length,
			});

			await logger.flush();
		},
	};
}

async function captureScreenshot(
	page: Page,
	filePath: string,
	logger: LoggerApi,
): Promise<void> {
	try {
		const buffer = await page.screenshot({ fullPage: false, timeout: 5000 });
		writeFileSync(filePath, buffer);
	} catch (err) {
		logger.warn("Failed to capture screenshot", {
			path: filePath,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

async function generateDebugBundle(
	page: Page,
	stepName: string,
	error: unknown,
	logDir: string,
	logPath: string,
	stepHistory: StepHistoryEntry[],
	logger: LoggerApi,
): Promise<{ bundlePath: string }> {
	const screenshotPath = join(logDir, `${stepName}-error.png`);
	const domPath = join(logDir, `${stepName}-error.html`);
	const bundlePath = join(logDir, `${stepName}-debug-bundle.json`);

	// Capture error screenshot
	await captureScreenshot(page, screenshotPath, logger);

	// Capture DOM
	try {
		const html = await page.content();
		writeFileSync(domPath, html);
	} catch (domErr) {
		logger.warn("Failed to capture DOM for debug bundle", {
			error: domErr instanceof Error ? domErr.message : String(domErr),
		});
	}

	let pageUrl = "";
	try {
		pageUrl = page.url();
	} catch {}

	const bundle: DebugBundle = {
		timestamp: new Date().toISOString(),
		step: stepName,
		error: error instanceof Error ? error.message : String(error),
		stacktrace: error instanceof Error ? (error.stack ?? "") : "",
		screenshotPath,
		domPath,
		logPath,
		stepHistory,
		pageUrl,
	};

	writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));

	return { bundlePath };
}
