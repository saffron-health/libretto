import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "affordance",
    environment: "node",
    include: ["test/**/*.spec.ts", "test/**/*.test.ts", "src/**/*.spec.ts"],
    testTimeout: 30_000,
    reporters: ["minimal"],
  },
});
