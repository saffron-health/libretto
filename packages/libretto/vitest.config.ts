import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "libretto",
    environment: "node",
    include: ["test/**/*.spec.ts", "src/**/*.spec.ts"],
    testTimeout: 30_000,
    pool: "forks",
    isolate: true,
    fileParallelism: true,
    maxWorkers: 4,
    reporters: ["minimal"],
  },
});
