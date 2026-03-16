import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { LIBRETTO_CONFIG_PATH } from "./context.js";

export const CURRENT_CONFIG_VERSION = 1;

/**
 * AI configuration schema.
 *
 * The `model` field is a provider/model-id string (e.g. "openai/gpt-5.4",
 * "anthropic/claude-sonnet-4-6", "google/gemini-3-flash-preview", "vertex/gemini-2.5-pro").
 *
 * Legacy note: earlier versions stored a `preset` (codex|claude|gemini) and
 * `commandPrefix` (CLI args to spawn a sub-agent process). That approach has
 * been replaced by direct API calls via the Vercel AI SDK. The legacy CLI-agent
 * code is preserved in snapshot-analyzer.ts but is not wired into the snapshot
 * command.
 */
export const AiConfigSchema = z.object({
  model: z.string().min(1),
  updatedAt: z.string(),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;

export const ViewportConfigSchema = z.object({
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
export type ViewportConfig = z.infer<typeof ViewportConfigSchema>;

export const LibrettoConfigSchema = z
  .object({
    version: z.literal(CURRENT_CONFIG_VERSION),
    ai: AiConfigSchema.optional(),
    viewport: ViewportConfigSchema.optional(),
  })
  .passthrough();
export type LibrettoConfig = z.infer<typeof LibrettoConfigSchema>;

/** Default models for each provider shorthand accepted by `ai configure`. */
const DEFAULT_MODELS: Record<string, string> = {
  openai: "openai/gpt-5.4",
  anthropic: "anthropic/claude-sonnet-4-6",
  gemini: "google/gemini-3-flash-preview",
  vertex: "vertex/gemini-2.5-pro",
};

const PROVIDER_ALIASES: Record<string, string> = {
  claude: DEFAULT_MODELS.anthropic,
  google: DEFAULT_MODELS.gemini,
};

const CONFIGURE_PROVIDERS = ["openai", "anthropic", "gemini", "vertex"] as const;

function formatConfigureProviders(separator = " | "): string {
  return CONFIGURE_PROVIDERS.join(separator);
}

function formatConfigIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("\n");
}

function formatExpectedConfigExample(): string {
  return JSON.stringify(
    {
      version: CURRENT_CONFIG_VERSION,
      ai: {
        model: "openai/gpt-5.4",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      viewport: {
        width: 1280,
        height: 800,
      },
    },
    null,
    2,
  );
}

function invalidConfigError(configPath: string, detail?: string): Error {
  return new Error(
    [
      `AI config is invalid at ${configPath}.`,
      detail ? `Problems:\n${detail}` : null,
      "Expected config example:",
      formatExpectedConfigExample(),
      "Notes:",
      '  - "ai" and "viewport" are optional.',
      '  - "ai.model" must be a provider/model string like "openai/gpt-5.4" or "anthropic/claude-sonnet-4-6".',
      "Fix the file to match this shape, or delete it and rerun:",
      `  npx libretto ai configure ${formatConfigureProviders()}`,
    ].filter(Boolean).join("\n"),
  );
}

function parseConfig(raw: string, configPath: string): LibrettoConfig {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw invalidConfigError(
      configPath,
      `  - root: Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsed = LibrettoConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw invalidConfigError(configPath, formatConfigIssues(parsed.error));
  }
  return parsed.data;
}

export function readLibrettoConfig(
  configPath: string = LIBRETTO_CONFIG_PATH,
): LibrettoConfig {
  if (!existsSync(configPath)) {
    return { version: CURRENT_CONFIG_VERSION };
  }
  return parseConfig(readFileSync(configPath, "utf-8"), configPath);
}

export function writeLibrettoConfig(
  config: LibrettoConfig,
  configPath: string = LIBRETTO_CONFIG_PATH,
): LibrettoConfig {
  const parsed = LibrettoConfigSchema.parse(config);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(parsed, null, 2), "utf-8");
  return parsed;
}

export function readAiConfig(
  configPath: string = LIBRETTO_CONFIG_PATH,
): AiConfig | null {
  return readLibrettoConfig(configPath).ai ?? null;
}

export function writeAiConfig(
  model: string,
  configPath: string = LIBRETTO_CONFIG_PATH,
): AiConfig {
  const librettoConfig = readLibrettoConfig(configPath);
  const ai = AiConfigSchema.parse({
    model,
    updatedAt: new Date().toISOString(),
  });
  writeLibrettoConfig(
    {
      ...librettoConfig,
      version: CURRENT_CONFIG_VERSION,
      ai,
    },
    configPath,
  );
  return ai;
}

export function clearAiConfig(
  configPath: string = LIBRETTO_CONFIG_PATH,
): boolean {
  const librettoConfig = readLibrettoConfig(configPath);
  if (!librettoConfig.ai) return false;
  const { ai: _ai, ...rest } = librettoConfig;
  writeLibrettoConfig(
    {
      ...rest,
    },
    configPath,
  );
  return true;
}

function printAiConfig(config: AiConfig, configPath: string): void {
  console.log(`Model: ${config.model}`);
  console.log(`Config file: ${configPath}`);
  console.log(`Updated at: ${config.updatedAt}`);
}

/**
 * Resolve the model string from a `ai configure` argument.
 * Accepts a provider shorthand ("openai", "anthropic", "gemini", "vertex")
 * or a full provider/model-id string ("openai/gpt-4o", "anthropic/claude-sonnet-4-6").
 */
function resolveModelFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Full model string (contains a slash)
  if (trimmed.includes("/")) return trimmed;

  // Provider shorthand
  const normalized = trimmed.toLowerCase();
  return DEFAULT_MODELS[normalized] ?? PROVIDER_ALIASES[normalized] ?? null;
}

export function runAiConfigure(
  input: {
    preset?: string;
    clear?: boolean;
  },
  options: {
    configureCommandName?: string;
    configPath?: string;
  } = {},
): void {
  const configureCommandName =
    options.configureCommandName ?? "npx libretto ai configure";
  const configPath = options.configPath ?? LIBRETTO_CONFIG_PATH;

  const presetArg = input.preset?.trim();

  if (!presetArg && !input.clear) {
    const config = readAiConfig(configPath);
    if (!config) {
      console.log(
        `No AI config set. Choose a default model: ${configureCommandName} ${formatConfigureProviders()}`,
      );
      console.log("Provider credentials still come from your shell or .env file.");
      return;
    }
    printAiConfig(config, configPath);
    return;
  }

  if (input.clear) {
    const removed = clearAiConfig(configPath);
    if (removed) {
      console.log(`Cleared AI config: ${configPath}`);
    } else {
      console.log("No AI config was set.");
    }
    return;
  }

  const model = resolveModelFromInput(presetArg!);
  if (!model) {
    console.log(
      `Usage: ${configureCommandName} <${CONFIGURE_PROVIDERS.join("|")}|provider/model-id>\n` +
        `       ${configureCommandName}\n` +
        `       ${configureCommandName} --clear`,
    );
    throw new Error(
      `Invalid provider or model. Use one of: ${formatConfigureProviders()}, or a full model string like "openai/gpt-4o".`,
    );
  }

  const config = writeAiConfig(model, configPath);
  console.log("AI config saved.");
  printAiConfig(config, configPath);
}
