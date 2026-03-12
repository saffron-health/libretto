import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "libretto-evals",
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    testTimeout: 0,
    maxConcurrency: 1000,
    pool: "forks",
    isolate: true,
    fileParallelism: true,
    maxWorkers: "100%",
    sequence: {
      concurrent: true,
    },
  },
});
