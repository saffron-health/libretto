import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  ClaudeEvalHarness,
  ensureClaudeAuthConfigured,
} from "../../evals/harness.js";
import { requireBenchmarkKernelApiKey } from "./kernel.js";
import {
  createSolveCaptchaMcpServer,
} from "./solve-captcha-tool.js";
import { benchmarkHooks } from "./hooks.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(here, "../..");
const skillSourcePath = resolve(packageRoot, ".agents/skills/libretto");
const analyzerPath = resolve(
  packageRoot,
  "benchmarks/shared/claude-snapshot-analyzer.mjs",
);
const distPath = resolve(packageRoot, "dist");

const DEFAULT_BENCHMARK_MODEL = "claude-opus-4-6";
const BENCHMARK_SKILL_TOOL_NAME = "Skill";

export function getBenchmarkPackageRoot(): string {
  return packageRoot;
}

export function getBenchmarkSkillSourcePath(): string {
  return skillSourcePath;
}

export function getBenchmarkAnalyzerPath(): string {
  return analyzerPath;
}

export function getBenchmarkDistPath(): string {
  return distPath;
}

export function getBenchmarkWorkspaceSkillRelativePath(): string {
  return ".claude/skills/libretto";
}

export async function createClaudeBenchmarkHarness(
  cwd: string,
): Promise<ClaudeEvalHarness> {
  ensureClaudeAuthConfigured();
  requireBenchmarkKernelApiKey();
  return new ClaudeEvalHarness({
    cwd,
    model:
      process.env.LIBRETTO_BENCHMARK_MODEL?.trim() ||
      process.env.LIBRETTO_EVAL_MODEL?.trim() ||
      DEFAULT_BENCHMARK_MODEL,
    mcpServers: createSolveCaptchaMcpServer(cwd),
    hooks: benchmarkHooks,
    maxTurns: 200,
    settingSources: ["project"],
    allowedTools: [BENCHMARK_SKILL_TOOL_NAME],
  });
}
