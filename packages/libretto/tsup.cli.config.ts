import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/cli/**/*.ts", "!src/cli/**/*.test.ts"],
	format: ["esm"],
	dts: false,
	bundle: false,
	minify: false,
	clean: false,
	outDir: "dist/cli",
});
