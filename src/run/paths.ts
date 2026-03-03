import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { LaunchConfig } from "./types.js";

export function resolveRepoRoot(config?: Pick<LaunchConfig, "repoRoot">): string {
  if (config?.repoRoot) return config.repoRoot;
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return process.cwd();
}

export function resolveLogFile(session: string, config?: Pick<LaunchConfig, "io" | "repoRoot">): string {
  if (config?.io?.logFile) return config.io.logFile;
  return resolve(resolveRepoRoot(config), "tmp", "logs", `${session}.jsonl`);
}

export function resolveSignalDir(config?: Pick<LaunchConfig, "io" | "repoRoot">): string {
  if (config?.io?.signalDir) return config.io.signalDir;
  return resolve(resolveRepoRoot(config), "tmp", "signals");
}

export function resolveStateDir(config?: Pick<LaunchConfig, "io" | "repoRoot">): string {
  if (config?.io?.stateDir) return config.io.stateDir;
  return resolve(resolveRepoRoot(config), "tmp", "state");
}

export function resolveEntrypoint(config?: Pick<LaunchConfig, "repoRoot">): string {
  return resolve(resolveRepoRoot(config), "packages", "libretto", "src", "run", "entrypoint.ts");
}

export function resolveRegistryPath(config?: Pick<LaunchConfig, "registryPath" | "repoRoot">): string | null {
  if (config?.registryPath) return config.registryPath;

  const conventional = resolve(
    resolveRepoRoot(config),
    "integrations", "src", "integrations", "registry.ts",
  );

  if (existsSync(conventional)) return conventional;

  return null;
}
