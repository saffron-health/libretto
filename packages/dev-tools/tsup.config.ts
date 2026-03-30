import { defineConfig } from "tsup";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

function ensureShebang(): void {
  const entryPath = "dist/wt.js";
  const content = readFileSync(entryPath, "utf-8");

  if (!content.startsWith("#!/")) {
    writeFileSync(entryPath, `#!/usr/bin/env node\n${content}`);
  }

  chmodSync(entryPath, 0o755);
}

export default defineConfig({
  entry: ["src/wt.ts"],
  format: ["esm"],
  dts: false,
  bundle: false,
  minify: false,
  clean: true,
  outDir: "dist",
  onSuccess: async () => {
    ensureShebang();
  },
});
