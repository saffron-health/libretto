import { readSnapshotModel } from "./config.js";
import { LIBRETTO_CONFIG_PATH } from "./context.js";
import {
  hasProviderCredentials,
  parseModel,
  type Provider,
} from "./resolve-model.js";
import { loadEnv } from "../../shared/env/load-env.js";

// Re-export so existing consumers (e.g. tests) don't break.
export { parseDotEnvAssignment } from "../../shared/env/load-env.js";

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
 * 1. snapshotModel from .libretto/config.json (set via `ai configure`)
 * 2. Auto-detect from available API credentials in env
 */
export function resolveSnapshotApiModel(
  snapshotModel: string | null = readSnapshotModel(),
): SnapshotApiModelSelection | null {
  loadEnv();

  if (snapshotModel) {
    const { provider } = parseModel(snapshotModel);
    return {
      model: snapshotModel,
      provider,
      source: "config",
    };
  }

  return inferAutoSnapshotModel();
}

export function resolveSnapshotApiModelOrThrow(
  snapshotModel: string | null = readSnapshotModel(),
): SnapshotApiModelSelection {
  const selection = resolveSnapshotApiModel(snapshotModel);
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
 * Read snapshot model without throwing on invalid files.
 * Returns the model string or an error message.
 */
function readSnapshotModelSafely(
  configPath: string,
): { ok: true; model: string | null } | { ok: false; message: string } {
  try {
    return { ok: true, model: readSnapshotModel(configPath) };
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
 * 2. If config has a `snapshotModel` → check credentials for that provider.
 * 3. If no `snapshotModel` → auto-detect from env via existing resolver.
 */
export function resolveAiSetupStatus(
  configPath: string = LIBRETTO_CONFIG_PATH,
): AiSetupStatus {
  loadEnv();

  const result = readSnapshotModelSafely(configPath);

  if (!result.ok) {
    return { kind: "invalid-config", message: result.message };
  }

  // Config has a snapshotModel — use it directly to check credentials
  if (result.model) {
    let selection: SnapshotApiModelSelection | null;
    try {
      selection = resolveSnapshotApiModel(result.model);
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

  // No snapshotModel — fall back to env auto-detect via existing resolver
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
