import { defineConfig } from "tsup";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

function ensureCliShebang(): void {
	const entryPath = "dist/cli/index.js";
	const content = readFileSync(entryPath, "utf-8");

	if (!content.startsWith("#!/")) {
		writeFileSync(entryPath, `#!/usr/bin/env node\n${content}`);
	}

	chmodSync(entryPath, 0o755);
}

export default defineConfig([
	{
		entry: ["src/**/*.ts", "!src/cli/**", "!src/**/*.test.ts"],
		format: ["esm"],
		dts: true,
		bundle: false,
		minify: false,
		clean: true,
		outDir: "dist",
	},
	{
		entry: ["src/cli/**/*.ts", "!src/cli/**/*.test.ts"],
		format: ["esm"],
		dts: false,
		bundle: false,
		minify: false,
		clean: false,
		outDir: "dist/cli",
		onSuccess: async () => {
			ensureCliShebang();
		},
	},
]);
