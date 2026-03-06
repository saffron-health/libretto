import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"workers/run-integration-worker": "src/workers/run-integration-worker.ts",
	},
	format: ["esm"],
	dts: false,
	clean: true,
	bundle: true,
	splitting: false,
	minify: false,
	banner: {
		js: "#!/usr/bin/env node",
	},
	outDir: "dist",
});
