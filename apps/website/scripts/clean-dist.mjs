import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));

rmSync(distDir, { recursive: true, force: true });
