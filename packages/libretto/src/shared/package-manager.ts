import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveLibrettoRepoRoot } from "./paths/repo-root.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

function packageManagerFromUserAgent(
  env: NodeJS.ProcessEnv = process.env,
): PackageManager | null {
  const userAgent = env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  if (userAgent.startsWith("bun")) return "bun";
  if (userAgent.startsWith("npm")) return "npm";
  return null;
}

function packageManagerFromLockfile(root: string): PackageManager | null {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock")))
    return "bun";
  return null;
}

export function detectPackageManager(
  root = resolveLibrettoRepoRoot(),
  env: NodeJS.ProcessEnv = process.env,
): PackageManager {
  const fromUserAgent = packageManagerFromUserAgent(env);
  if (fromUserAgent) return fromUserAgent;

  return packageManagerFromLockfile(root) ?? "npm";
}

export function detectProjectPackageManager(
  root = resolveLibrettoRepoRoot(),
): PackageManager {
  return packageManagerFromLockfile(root) ?? "npm";
}

export function installCommand(
  packageManager = detectProjectPackageManager(),
): string {
  switch (packageManager) {
    case "yarn":
      return "yarn add";
    case "bun":
      return "bun add";
    case "pnpm":
      return "pnpm add";
    default:
      return "npm install";
  }
}

export function librettoCommand(
  args = "",
  _packageManager?: PackageManager,
): string {
  const suffix = args.trim();
  return `libretto${suffix ? ` ${suffix}` : ""}`;
}
