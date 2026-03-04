import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"step/index": "src/step/index.ts",
		"logger/index": "src/logger/index.ts",
		"recovery/index": "src/recovery/index.ts",
		"extract/index": "src/extract/index.ts",
		"network/index": "src/network/index.ts",
		"download/index": "src/download/index.ts",
		"debug/index": "src/debug/index.ts",
		"config/index": "src/config/index.ts",
		"instrumentation/index": "src/instrumentation/index.ts",
		"visualization/index": "src/visualization/index.ts",
		"llm/index": "src/llm/index.ts",
		"run/api": "src/run/api.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	splitting: true,
	clean: true,
	outDir: "dist",
});
