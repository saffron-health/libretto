import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "browser-tools",
    environment: "node",
    include: ["src/**/*.spec.ts"],
    testTimeout: 30_000,
    pool: "forks",
    isolate: true,
    fileParallelism: true,
    maxWorkers: 4,
    reporters: ["minimal"],
  },
});
