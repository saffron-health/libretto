import { readAiConfig, type AiConfig } from "./ai-config.js";
import { LIBRETTO_CONFIG_PATH } from "./context.js";
import {
  loadSnapshotEnv,
  resolveSnapshotApiModel,
  type SnapshotApiModelSelection,
} from "./snapshot-api-config.js";
import {
  hasProviderCredentials,
  type Provider,
} from "../../shared/llm/client.js";

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
      source: "config" | `env:auto-${string}`;
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
    const selection = resolveSnapshotApiModel(configResult.config);
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
