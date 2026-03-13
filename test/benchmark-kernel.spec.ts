import { describe, expect, test } from "vitest";
import { getBenchmarkWorkspaceCliScript } from "../benchmarks/shared/cases.js";
import { requireBenchmarkKernelApiKey } from "../benchmarks/shared/kernel.js";

describe("benchmark kernel bootstrap", () => {
	test("workspace cli script forces kernel provider", () => {
		expect(getBenchmarkWorkspaceCliScript()).toBe(
			'KERNEL_API_KEY="$BENCHMARKS_KERNEL_API_KEY" LIBRETTO_BROWSER_PROVIDER=kernel LIBRETTO_REPO_ROOT=. node ./dist/cli/index.js',
		);
	});

	test("reads BENCHMARKS_KERNEL_API_KEY from the environment", () => {
		expect(
			requireBenchmarkKernelApiKey({
				BENCHMARKS_KERNEL_API_KEY: "benchmark-key",
			} as NodeJS.ProcessEnv),
		).toBe("benchmark-key");
	});

	test("trims BENCHMARKS_KERNEL_API_KEY", () => {
		expect(
			requireBenchmarkKernelApiKey({
				BENCHMARKS_KERNEL_API_KEY: "  benchmark-key  ",
			} as NodeJS.ProcessEnv),
		).toBe("benchmark-key");
	});

	test("throws a clear error when BENCHMARKS_KERNEL_API_KEY is missing", () => {
		expect(
			() => requireBenchmarkKernelApiKey({} as NodeJS.ProcessEnv),
		).toThrowError("Expected BENCHMARKS_KERNEL_API_KEY to be set in the environment.");
	});
});
