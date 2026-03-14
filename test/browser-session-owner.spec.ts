import { afterEach, describe, expect, test, vi } from "vitest";
import type { LoggerApi } from "../src/shared/logger/index.js";
import { abortSessionOwnerStartup } from "../src/cli/core/browser.js";

function createLogger(): LoggerApi {
	return {
		log: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn((_: string, data?: unknown) =>
			data instanceof Error ? data : new Error(String(data ?? "logger-error")),
		),
		withScope: vi.fn(() => createLogger()),
		withContext: vi.fn(() => createLogger()),
		flush: vi.fn(async () => undefined),
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("session owner startup abort", () => {
	test("stops the worker with SIGTERM when it exits gracefully", async () => {
		vi.useFakeTimers();
		let alive = true;
		const signals: Array<number | NodeJS.Signals | undefined> = [];
		vi.spyOn(process, "kill").mockImplementation(
			((pid: number, signal?: number | NodeJS.Signals) => {
				expect(pid).toBe(1234);
				signals.push(signal);
				if (signal === 0) {
					if (!alive) {
						const error = new Error("missing") as NodeJS.ErrnoException;
						error.code = "ESRCH";
						throw error;
					}
					return true;
				}

				if (signal === "SIGTERM") {
					alive = false;
				}
				return true;
			}) as typeof process.kill,
		);

		const logger = createLogger();
		const promise = abortSessionOwnerStartup(1234, "bench-1", "kernel", logger);
		await vi.runAllTimersAsync();
		await promise;

		expect(signals).toEqual([0, "SIGTERM", 0]);
		expect(logger.warn).toHaveBeenCalledWith("open-child-stop-start", {
			session: "bench-1",
			provider: "kernel",
			pid: 1234,
		});
		expect(logger.info).toHaveBeenCalledWith("open-child-stop-complete", {
			session: "bench-1",
			provider: "kernel",
			pid: 1234,
			signal: "SIGTERM",
		});
	});

	test("falls back to SIGKILL when the worker ignores SIGTERM", async () => {
		vi.useFakeTimers();
		let alive = true;
		const signals: Array<number | NodeJS.Signals | undefined> = [];
		vi.spyOn(process, "kill").mockImplementation(
			((pid: number, signal?: number | NodeJS.Signals) => {
				expect(pid).toBe(5678);
				signals.push(signal);
				if (signal === 0) {
					if (!alive) {
						const error = new Error("missing") as NodeJS.ErrnoException;
						error.code = "ESRCH";
						throw error;
					}
					return true;
				}

				if (signal === "SIGKILL") {
					alive = false;
				}
				return true;
			}) as typeof process.kill,
		);

		const logger = createLogger();
		const promise = abortSessionOwnerStartup(5678, "bench-2", "kernel", logger);
		await vi.runAllTimersAsync();
		await promise;

		expect(signals).toEqual([0, "SIGTERM", 0, "SIGKILL", 0]);
		expect(logger.warn).toHaveBeenCalledWith("open-child-force-stop", {
			session: "bench-2",
			provider: "kernel",
			pid: 5678,
		});
		expect(logger.info).toHaveBeenCalledWith("open-child-stop-complete", {
			session: "bench-2",
			provider: "kernel",
			pid: 5678,
			signal: "SIGKILL",
		});
	});
});
