#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MIRRORS, compareMirrors } from "./mirrors-libretto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");
const result = compareMirrors(repoRoot);

if (result.ok) {
  console.log(
    `libretto: verified mirror parity for ${MIRRORS.map((mirror) => mirror.name).join(", ")}`,
  );
  process.exit(0);
}

console.error("libretto: mirrors must be in sync:");
for (const issue of result.issues) {
  console.error(`- ${issue}`);
}
console.error("");
console.error("Run `pnpm sync:mirrors` to resync generated files and mirrors.");
process.exit(1);
