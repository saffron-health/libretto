import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/**/*.ts", "!src/**/*.test.ts", "!src/**/*.spec.ts"],
	format: ["esm"],
	dts: false,
	clean: true,
	bundle: false,
	minify: false,
	banner: {
		js: "#!/usr/bin/env node",
	},
	outDir: "dist",
});
