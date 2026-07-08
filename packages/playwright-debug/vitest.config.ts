import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "playwright-debug",
    environment: "node",
    include: ["test/**/*.spec.ts", "src/**/*.spec.ts"],
    testTimeout: 30_000,
    reporters: ["minimal"],
  },
});
