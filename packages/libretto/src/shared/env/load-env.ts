import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveLibrettoRepoRoot } from "../paths/repo-root.js";

const REPO_ROOT = resolveLibrettoRepoRoot();

export function parseDotEnvAssignment(
  line: string,
): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const withoutExport = trimmed.startsWith("export ")
    ? trimmed.slice("export ".length).trimStart()
    : trimmed;
  const eqIdx = withoutExport.indexOf("=");
  if (eqIdx < 1) return null;

  const key = withoutExport.slice(0, eqIdx).trim();
  if (!key) return null;

  const rawValue = withoutExport.slice(eqIdx + 1).trimStart();
  if (!rawValue) {
    return { key, value: "" };
  }

  if (rawValue.startsWith('"')) {
    const closeIdx = rawValue.indexOf('"', 1);
    if (closeIdx > 0) {
      return { key, value: rawValue.slice(1, closeIdx) };
    }
    return { key, value: rawValue.slice(1) };
  }

  if (rawValue.startsWith("'")) {
    const closeIdx = rawValue.indexOf("'", 1);
    if (closeIdx > 0) {
      return { key, value: rawValue.slice(1, closeIdx) };
    }
    return { key, value: rawValue.slice(1) };
  }

  const inlineCommentIndex = rawValue.search(/\s#/);
  const value =
    inlineCommentIndex >= 0
      ? rawValue.slice(0, inlineCommentIndex).trimEnd()
      : rawValue.trim();
  return { key, value };
}

function readWorktreeEnvPath(): string | null {
  const gitPath = join(REPO_ROOT, ".git");
  if (!existsSync(gitPath)) return null;

  try {
    const gitPointer = readFileSync(gitPath, "utf-8").trim();
    const match = gitPointer.match(/^gitdir:\s*(.+)$/i);
    if (!match?.[1]) return null;
    const worktreeGitDir = resolve(REPO_ROOT, match[1].trim());
    const commonGitDir = resolve(worktreeGitDir, "..", "..");
    return join(dirname(commonGitDir), ".env");
  } catch {
    return null;
  }
}

/**
 * Load the `.env` file at the repository root into `process.env`.
 * Existing values are never overridden.
 * Respects `LIBRETTO_DISABLE_DOTENV=1` to skip loading entirely.
 * Returns the path of the loaded `.env`, or `null` if none was found.
 */
export function loadEnv(): string | null {
  if (process.env.LIBRETTO_DISABLE_DOTENV?.trim() === "1") return null;

  const envPathCandidates = [
    join(REPO_ROOT, ".env"),
    readWorktreeEnvPath(),
  ].filter((value): value is string => Boolean(value));

  const envPath = envPathCandidates.find((candidate) => existsSync(candidate));
  if (!envPath) return null;

  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const parsed = parseDotEnvAssignment(line);
    if (!parsed) continue;
    if (!(parsed.key in process.env)) {
      process.env[parsed.key] = parsed.value;
    }
  }
  return envPath;
}
