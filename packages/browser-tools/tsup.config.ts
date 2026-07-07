import { defineConfig } from "tsup";

// Per-file output (bundle: false) so framework subpath entries
// (./ai-sdk, ./flue, ...) can be added as plain source files later.
export default defineConfig({
  entry: ["src/**/*.ts", "!src/**/*.spec.ts"],
  format: ["esm"],
  dts: true,
  bundle: false,
  minify: false,
  clean: true,
  outDir: "dist",
});
