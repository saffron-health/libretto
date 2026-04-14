import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Walk up from `startDir` until a `.env` file is found.
 * Returns the full path to the `.env`, or `null` if the filesystem root is reached.
 */
function findNearestEnv(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) return envPath;
    const parent = dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
}

/**
 * Parse a `.env` file into key-value pairs.
 * Handles KEY=VALUE, KEY="VALUE", KEY='VALUE', comments (#), and blank lines.
 * Does not support multiline values or variable interpolation.
 */
function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ")
      ? line.slice("export ".length).trimStart()
      : line;
    const eqIndex = withoutExport.indexOf("=");
    if (eqIndex === -1) continue;
    const key = withoutExport.slice(0, eqIndex).trim();
    let value = withoutExport.slice(eqIndex + 1).trim();
    // Handle quoted values (with or without trailing inline comments)
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const closeIndex = value.indexOf(quote, 1);
      if (closeIndex !== -1) {
        value = value.slice(1, closeIndex);
      }
    } else {
      // Strip inline comments from unquoted values
      const commentIndex = value.search(/\s#/);
      if (commentIndex >= 0) {
        value = value.slice(0, commentIndex).trimEnd();
      }
    }
    vars[key] = value;
  }
  return vars;
}

/**
 * Load the nearest `.env` file above `scriptPath`.
 * Existing `process.env` values are never overridden.
 * Returns the path of the loaded `.env`, or `null` if none was found.
 */
export function loadProjectEnv(scriptPath: string): string | null {
  const envPath = findNearestEnv(dirname(scriptPath));
  if (!envPath) return null;

  const vars = parseEnvFile(readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return envPath;
}
