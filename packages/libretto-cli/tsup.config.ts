import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
	},
	format: ["esm"],
	dts: false,
	clean: true,
	bundle: false,
	banner: {
		js: "#!/usr/bin/env node",
	},
	outDir: "dist",
});
