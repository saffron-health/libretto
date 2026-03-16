import { defineConfig } from "tsup";
import { writeFileSync, readFileSync, chmodSync } from "node:fs";

export default defineConfig({
	entry: ["src/cli/**/*.ts", "!src/cli/**/*.test.ts"],
	format: ["esm"],
	dts: false,
	bundle: false,
	minify: false,
	clean: false,
	outDir: "dist/cli",
	onSuccess: async () => {
		const entryPath = "dist/cli/index.js";
		const content = readFileSync(entryPath, "utf-8");
		if (!content.startsWith("#!/")) {
			writeFileSync(entryPath, `#!/usr/bin/env node\n${content}`);
		}
		chmodSync(entryPath, 0o755);
	},
});
