import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "browser-tools-evals",
		environment: "node",
		setupFiles: ["evals/setup.ts"],
		include: ["evals/**/*.eval.ts"],
		testTimeout: 120_000,
		pool: "forks",
		isolate: true,
		fileParallelism: false,
		maxWorkers: 1,
		maxConcurrency: 5,
		reporters: ["minimal"],
	},
});
