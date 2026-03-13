import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  ClaudeEvalHarness,
  ensureClaudeAuthConfigured,
} from "../../evals/harness.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(here, "../..");
const skillPath = resolve(packageRoot, ".agents/skills/libretto/SKILL.md");
const analyzerPath = resolve(
  packageRoot,
  "benchmarks/shared/claude-snapshot-analyzer.mjs",
);
const distPath = resolve(packageRoot, "dist");

let cachedSkillMarkdown: string | null = null;
const DEFAULT_BENCHMARK_MODEL = "claude-opus-4-6";

export function getBenchmarkPackageRoot(): string {
  return packageRoot;
}

export function getBenchmarkSkillPath(): string {
  return skillPath;
}

export function getBenchmarkAnalyzerPath(): string {
  return analyzerPath;
}

export function getBenchmarkDistPath(): string {
  return distPath;
}

export async function getBenchmarkSkillMarkdown(): Promise<string> {
  if (cachedSkillMarkdown !== null) return cachedSkillMarkdown;
  cachedSkillMarkdown = await readFile(skillPath, "utf8");
  return cachedSkillMarkdown;
}

export async function createClaudeBenchmarkHarness(
  cwd: string,
): Promise<ClaudeEvalHarness> {
  ensureClaudeAuthConfigured();
  const librettoSkillMarkdown = await getBenchmarkSkillMarkdown();
  return new ClaudeEvalHarness({
    cwd,
    model:
      process.env.LIBRETTO_BENCHMARK_MODEL?.trim() ||
      process.env.LIBRETTO_EVAL_MODEL?.trim() ||
      DEFAULT_BENCHMARK_MODEL,
    librettoSkillMarkdown,
    maxTurns: 30,
  });
}
