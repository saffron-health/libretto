#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MIRRORS, syncMirrors } from "./mirrors-libretto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");

syncMirrors(repoRoot);
console.log(
  `libretto: synced mirrors for ${MIRRORS.map((mirror) => mirror.name).join(", ")}`,
);
