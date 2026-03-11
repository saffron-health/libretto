import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "libretto-evals",
    environment: "node",
    include: ["evals/**/*.spec.ts"],
    testTimeout: 180_000,
    pool: "forks",
    isolate: true,
    fileParallelism: true,
    maxWorkers: "100%",
  },
});
