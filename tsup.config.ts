import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/**/*.ts", "!src/cli/**", "!src/**/*.test.ts"],
	format: ["esm", "cjs"],
	dts: true,
	bundle: false,
	minify: false,
	clean: true,
	outDir: "dist",
});
