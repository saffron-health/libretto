import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^libretto$/, replacement: resolve(__dirname, "../libretto/src/index.ts") },
      {
        find: /^libretto\/logger$/,
        replacement: resolve(__dirname, "../libretto/src/logger/index.ts"),
      },
      {
        find: /^libretto\/llm$/,
        replacement: resolve(__dirname, "../libretto/src/llm/index.ts"),
      },
      {
        find: /^libretto\/instrumentation$/,
        replacement: resolve(__dirname, "../libretto/src/instrumentation/index.ts"),
      },
      {
        find: /^libretto\/config$/,
        replacement: resolve(__dirname, "../libretto/src/config/index.ts"),
      },
      {
        find: /^libretto\/run$/,
        replacement: resolve(__dirname, "../libretto/src/run/api.ts"),
      },
    ],
  },
  test: {
    name: "libretto-cli",
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
