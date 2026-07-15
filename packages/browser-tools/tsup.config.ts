import { defineConfig } from "tsup";

// Per-file output (bundle: false) so framework adapters under src/adapters/
// can be added as index.ts entry points with matching package.json exports.
export default defineConfig({
  entry: ["src/**/*.ts", "!src/**/*.spec.ts"],
  format: ["esm"],
  dts: true,
  bundle: false,
  minify: false,
  clean: true,
  outDir: "dist",
});
