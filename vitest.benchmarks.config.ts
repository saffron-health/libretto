import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "libretto-benchmarks",
    environment: "node",
    include: ["benchmarks/**/*.spec.ts"],
    testTimeout: 0,
    pool: "forks",
    isolate: true,
    fileParallelism: true,
    maxWorkers: 4,
  },
});
