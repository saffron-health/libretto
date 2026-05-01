import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveLibrettoRepoRoot } from "../../shared/paths/repo-root.js";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
type Environment = Record<string, string | undefined>;

type RunCommandOptions = {
  cwd?: string;
  env?: Environment;
};

export function detectPackageManager(
  cwd: string = process.cwd(),
  env: Environment = process.env,
): PackageManager {
  const userAgent = env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  if (userAgent.startsWith("bun")) return "bun";
  if (userAgent.startsWith("npm")) return "npm";

  const root = resolveLibrettoRepoRoot(cwd);
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}

export function packageManagerRunCommand(
  packageManager: PackageManager = detectPackageManager(),
): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm exec";
    case "yarn":
      return "yarn";
    case "bun":
      return "bunx";
    case "npm":
      return "npx";
  }
}

export function runCommand(
  args?: string,
  options: RunCommandOptions = {},
): string {
  const trimmed = args?.trim();
  const packageManager = detectPackageManager(
    options.cwd ?? process.cwd(),
    options.env ?? process.env,
  );
  const base = `${packageManagerRunCommand(packageManager)} libretto`;
  return trimmed ? `${base} ${trimmed}` : base;
}
