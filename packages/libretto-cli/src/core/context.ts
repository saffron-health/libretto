import { Logger, createFileLogSink } from "libretto/logger";
import type { LLMClient } from "libretto/llm";
import { spawnSync } from "node:child_process";
import { cwd } from "node:process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

function getRepoRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  });
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return cwd();
}

export const REPO_ROOT = getRepoRoot();
export const STATE_DIR = join(REPO_ROOT, "tmp", "libretto-cli");
export const LIBRETTO_DIR = join(REPO_ROOT, ".libretto-cli");
export const PROFILES_DIR = join(LIBRETTO_DIR, "profiles");
export const SNAPSHOT_ANALYZER_CONFIG_PATH = join(
  LIBRETTO_DIR,
  "snapshot-config.json",
);

const LEGACY_PROFILES_DIR = join(REPO_ROOT, ".playwriter", "profiles");
if (existsSync(LEGACY_PROFILES_DIR) && !existsSync(PROFILES_DIR)) {
  mkdirSync(LIBRETTO_DIR, { recursive: true });
  renameSync(LEGACY_PROFILES_DIR, PROFILES_DIR);
}

const LEGACY_BT_PROFILES_DIR = join(REPO_ROOT, ".browser-tap", "profiles");
if (existsSync(LEGACY_BT_PROFILES_DIR) && !existsSync(PROFILES_DIR)) {
  mkdirSync(LIBRETTO_DIR, { recursive: true });
  renameSync(LEGACY_BT_PROFILES_DIR, PROFILES_DIR);
}

let log: Logger | null = null;

export function setLogFile(filePath: string): void {
  log = new Logger(["libretto-cli"], [createFileLogSink({ filePath })]);
}

export function ensureLog(): void {
  if (log) return;
  mkdirSync(STATE_DIR, { recursive: true });
  setLogFile(join(STATE_DIR, "cli.log"));
}

export function getLog(): Logger {
  ensureLog();
  return log as Logger;
}

export async function flushLog(): Promise<void> {
  if (!log) return;
  await log.flush();
}

let llmClientFactory:
  | ((logger: Logger, model: string) => Promise<LLMClient>)
  | null = null;

export function setLLMClientFactory(
  factory: (logger: Logger, model: string) => Promise<LLMClient>,
): void {
  llmClientFactory = factory;
}

export function getLLMClientFactory():
  | ((logger: Logger, model: string) => Promise<LLMClient>)
  | null {
  return llmClientFactory;
}

export function maybeConfigureLLMClientFactoryFromEnv(): void {
  if (llmClientFactory) return;

  const hasAnyCreds =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY;

  if (!hasAnyCreds) return;

  setLLMClientFactory(async (_logger, model) => {
    const { createLLMClient } = await import("libretto/llm");
    return createLLMClient(model);
  });
}
