import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type AiConfig, readAiConfig } from "./config.js";
import { LIBRETTO_CONFIG_PATH, REPO_ROOT } from "./context.js";
import {
  hasProviderCredentials,
  parseModel,
  type Provider,
} from "./resolve-model.js";

// ── Default models ──────────────────────────────────────────────────────────

export const DEFAULT_SNAPSHOT_MODELS = {
  openai: "openai/gpt-5.4",
  anthropic: "anthropic/claude-sonnet-4-6",
  google: "google/gemini-3-flash-preview",
  vertex: "vertex/gemini-2.5-flash",
} as const satisfies Record<Provider, string>;

// ── Source detection ────────────────────────────────────────────────────────

/**
 * Detect which specific env var provides credentials for a provider.
 * Returns the env var name (e.g. "OPENAI_API_KEY", "GEMINI_API_KEY"),
 * or null if no credential is found.
 */
function detectProviderEnvVar(
  provider: Provider,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  switch (provider) {
    case "openai":
      return env.OPENAI_API_KEY?.trim() ? "OPENAI_API_KEY" : null;
    case "anthropic":
      return env.ANTHROPIC_API_KEY?.trim() ? "ANTHROPIC_API_KEY" : null;
    case "google":
      if (env.GEMINI_API_KEY?.trim()) return "GEMINI_API_KEY";
      if (env.GOOGLE_GENERATIVE_AI_API_KEY?.trim())
        return "GOOGLE_GENERATIVE_AI_API_KEY";
      return null;
    case "vertex":
      if (env.GOOGLE_CLOUD_PROJECT?.trim()) return "GOOGLE_CLOUD_PROJECT";
      if (env.GCLOUD_PROJECT?.trim()) return "GCLOUD_PROJECT";
      return null;
  }
}

// ── Snapshot model resolution ───────────────────────────────────────────────

export type SnapshotApiModelSelection = {
  model: string;
  provider: Provider;
  source: "config" | `env:${string}`;
};

export class SnapshotApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotApiUnavailableError";
  }
}

function providerSetupSentence(provider: Provider): string {
  switch (provider) {
    case "openai":
      return "Add OPENAI_API_KEY to .env or as a shell environment variable.";
    case "anthropic":
      return "Add ANTHROPIC_API_KEY to .env or as a shell environment variable.";
    case "google":
      return "Add GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY to .env or as a shell environment variable.";
    case "vertex":
      return "Add GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT to .env or as a shell environment variable, and make sure application default credentials are configured.";
  }
}

function defaultModelCommandLine(): string {
  return "npx libretto ai configure openai | anthropic | gemini | vertex";
}

function providerMissingCredentialSummary(provider: Provider): string {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY is missing";
    case "anthropic":
      return "ANTHROPIC_API_KEY is missing";
    case "google":
      return "GEMINI_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY are missing";
    case "vertex":
      return "GOOGLE_CLOUD_PROJECT and GCLOUD_PROJECT are missing";
  }
}

function noSnapshotApiConfiguredMessage(): string {
  return [
    "Failed to analyze snapshot because no snapshot analyzer is configured.",
    `Add OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY, or GOOGLE_CLOUD_PROJECT to .env or as a shell environment variable, or choose a default model with \`${defaultModelCommandLine()}\`.`,
    "For more info, run `npx libretto setup`.",
  ].join(" ");
}

function missingProviderSnapshotMessage(
  selection: SnapshotApiModelSelection,
): string {
  const configuredSource =
    selection.source === "config"
      ? ` in ${LIBRETTO_CONFIG_PATH}`
      : " from process env or .env";
  return [
    `Failed to analyze snapshot because ${selection.provider} is configured${configuredSource}, but ${providerMissingCredentialSummary(selection.provider)}.`,
    providerSetupSentence(selection.provider),
    "For more info, run `npx libretto setup`.",
  ].join(" ");
}

// ── Dotenv loading ──────────────────────────────────────────────────────────

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

export function loadSnapshotEnv(): void {
  if (process.env.LIBRETTO_DISABLE_DOTENV?.trim() === "1") return;

  const envPathCandidates = [
    join(REPO_ROOT, ".env"),
    readWorktreeEnvPath(),
  ].filter((value): value is string => Boolean(value));

  const envPath = envPathCandidates.find((candidate) => existsSync(candidate));
  if (!envPath) return;

  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const parsed = parseDotEnvAssignment(line);
    if (!parsed) continue;
    if (!(parsed.key in process.env)) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

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

// ── Model resolution ────────────────────────────────────────────────────────

function inferAutoSnapshotModel(): SnapshotApiModelSelection | null {
  const providersInPriorityOrder: Provider[] = [
    "openai",
    "anthropic",
    "google",
    "vertex",
  ];

  for (const provider of providersInPriorityOrder) {
    const envVar = detectProviderEnvVar(provider);
    if (!envVar) continue;
    return {
      model: DEFAULT_SNAPSHOT_MODELS[provider],
      provider,
      source: `env:${envVar}`,
    };
  }

  return null;
}

/**
 * Resolve which API model to use for snapshot analysis.
 *
 * Priority:
 * 1. Model from .libretto/config.json ai.model field (set via `ai configure`)
 * 2. Auto-detect from available API credentials in env
 */
export function resolveSnapshotApiModel(
  config: AiConfig | null = readAiConfig(),
): SnapshotApiModelSelection | null {
  loadSnapshotEnv();

  if (config?.model) {
    const { provider } = parseModel(config.model);
    return {
      model: config.model,
      provider,
      source: "config",
    };
  }

  return inferAutoSnapshotModel();
}

export function resolveSnapshotApiModelOrThrow(
  config: AiConfig | null = readAiConfig(),
): SnapshotApiModelSelection {
  const selection = resolveSnapshotApiModel(config);
  if (!selection) {
    throw new SnapshotApiUnavailableError(noSnapshotApiConfiguredMessage());
  }

  if (!hasProviderCredentials(selection.provider)) {
    throw new SnapshotApiUnavailableError(
      missingProviderSnapshotMessage(selection),
    );
  }

  return selection;
}

export function isSnapshotApiUnavailableError(error: unknown): boolean {
  return error instanceof SnapshotApiUnavailableError;
}

// ── AI setup status ─────────────────────────────────────────────────────────

/**
 * Workspace AI setup health states.
 *
 * - `ready`: a usable model was resolved and the matching provider has credentials.
 * - `configured-missing-credentials`: config pins a provider whose credentials are absent.
 * - `invalid-config`: `.libretto/config.json` exists but fails schema validation.
 * - `unconfigured`: no config and no env credentials detected.
 */
export type AiSetupStatus =
  | {
      kind: "ready";
      model: string;
      provider: Provider;
      source: "config" | `env:${string}`;
    }
  | {
      kind: "configured-missing-credentials";
      model: string;
      provider: Provider;
    }
  | { kind: "invalid-config"; message: string }
  | { kind: "unconfigured" };

/**
 * Read AI config without throwing on invalid files.
 * Returns the config or an error message.
 */
function readAiConfigSafely(
  configPath: string,
): { ok: true; config: AiConfig | null } | { ok: false; message: string } {
  try {
    return { ok: true, config: readAiConfig(configPath) };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Resolve the workspace's current AI setup health.
 *
 * Uses the existing config reader and snapshot model resolver, but wraps
 * them to distinguish broken states (invalid config, missing credentials)
 * that the throwing APIs collapse into errors.
 *
 * 1. If config read throws → `invalid-config`.
 * 2. If config has an `ai` block → check credentials for that provider.
 * 3. If no config or no `ai` block → auto-detect from env via existing resolver.
 */
export function resolveAiSetupStatus(
  configPath: string = LIBRETTO_CONFIG_PATH,
): AiSetupStatus {
  loadSnapshotEnv();

  const configResult = readAiConfigSafely(configPath);

  if (!configResult.ok) {
    return { kind: "invalid-config", message: configResult.message };
  }

  // Config exists with an ai block — use it directly to check credentials
  if (configResult.config) {
    let selection: SnapshotApiModelSelection | null;
    try {
      selection = resolveSnapshotApiModel(configResult.config);
    } catch (err) {
      return {
        kind: "invalid-config",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    if (!selection) {
      // Should not happen when config has a model, but handle gracefully
      return { kind: "unconfigured" };
    }
    if (hasProviderCredentials(selection.provider)) {
      return {
        kind: "ready",
        model: selection.model,
        provider: selection.provider,
        source: selection.source,
      };
    }
    return {
      kind: "configured-missing-credentials",
      model: selection.model,
      provider: selection.provider,
    };
  }

  // No ai config — fall back to env auto-detect via existing resolver
  const envSelection = resolveSnapshotApiModel(null);
  if (envSelection && hasProviderCredentials(envSelection.provider)) {
    return {
      kind: "ready",
      model: envSelection.model,
      provider: envSelection.provider,
      source: envSelection.source,
    };
  }

  return { kind: "unconfigured" };
}
