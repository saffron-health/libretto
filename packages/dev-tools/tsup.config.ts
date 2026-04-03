import { defineConfig } from "tsup";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const CLI_ENTRIES = ["dist/wt.js", "dist/create-tmp-workspace.js"];

function ensureShebangs(): void {
  for (const entryPath of CLI_ENTRIES) {
    const content = readFileSync(entryPath, "utf-8");

    if (!content.startsWith("#!/")) {
      writeFileSync(entryPath, `#!/usr/bin/env node\n${content}`);
    }

    chmodSync(entryPath, 0o755);
  }
}

export default defineConfig({
  entry: ["src/wt.ts", "src/create-tmp-workspace.ts", "src/tmp-workspace.ts"],
  format: ["esm"],
  dts: true,
  bundle: false,
  minify: false,
  clean: true,
  outDir: "dist",
  onSuccess: async () => {
    ensureShebangs();
  },
});
