import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRootCache = new Map<string, string>();

export function resolveLibrettoRepoRoot(cwd: string = process.cwd()): string {
  const override = process.env.LIBRETTO_REPO_ROOT?.trim();
  if (override) {
    return resolve(override);
  }

  const normalizedCwd = resolve(cwd);
  const cached = repoRootCache.get(normalizedCwd);
  if (cached) {
    return cached;
  }

  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: normalizedCwd,
    encoding: "utf-8",
  });

  const repoRoot =
    result.status === 0 && result.stdout ? result.stdout.trim() : normalizedCwd;
  repoRootCache.set(normalizedCwd, repoRoot);
  return repoRoot;
}
