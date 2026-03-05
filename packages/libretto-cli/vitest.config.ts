import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "libretto-cli",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
