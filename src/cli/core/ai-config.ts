import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { LIBRETTO_CONFIG_PATH } from "./context.js";

export const CURRENT_CONFIG_VERSION = 1;

export const AiPresetSchema = z.enum(["codex", "claude", "gemini"]);
export type AiPreset = z.infer<typeof AiPresetSchema>;
const AI_CONFIG_PRESET_INPUTS = ["codex", "claude", "gemini", "google-vertex-ai"] as const;
const AI_CONFIG_PRESET_USAGE = AI_CONFIG_PRESET_INPUTS.join("|");

type AiConfigurePresetResolution = {
  preset: AiPreset;
  model?: string;
};

export const AiConfigSchema = z
  .object({
    preset: AiPresetSchema,
    commandPrefix: z.array(z.string()).min(1),
    /** Model override for the sub-agent session (e.g. "claude-sonnet-4-6", "o4-mini"). */
    model: z.string().optional(),
    updatedAt: z.string(),
  })
  .strict();
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

export const AI_CONFIG_PRESETS: Record<AiPreset, Omit<AiConfig, "updatedAt">> = {
  codex: {
    preset: "codex",
    commandPrefix: ["codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only"],
  },
  claude: {
    preset: "claude",
    commandPrefix: [join(homedir(), ".claude", "local", "claude"), "-p"],
  },
  gemini: {
    preset: "gemini",
    commandPrefix: ["gemini", "--output-format", "json"],
  },
};

export function isDefaultCommandPrefixForPreset(config: AiConfig): boolean {
  const expected = AI_CONFIG_PRESETS[config.preset].commandPrefix;
  return (
    config.commandPrefix.length === expected.length
    && config.commandPrefix.every((value, index) => value === expected[index])
  );
}

function invalidConfigError(configPath: string): Error {
  return new Error(
    `AI config is invalid at ${configPath}. Fix the file to match the expected schema or delete it.`,
  );
}

function parseConfig(raw: string, configPath: string): LibrettoConfig {
  try {
    return LibrettoConfigSchema.parse(JSON.parse(raw));
  } catch {
    throw invalidConfigError(configPath);
  }
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

export function readAiConfig(configPath: string = LIBRETTO_CONFIG_PATH): AiConfig | null {
  return readLibrettoConfig(configPath).ai ?? null;
}

function quoteShellArg(value: string): string {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function formatCommandPrefix(prefix: string[]): string {
  return prefix.map((arg) => quoteShellArg(arg)).join(" ");
}

export function writeAiConfig(
  preset: AiPreset,
  commandPrefix: string[],
  configPath: string = LIBRETTO_CONFIG_PATH,
  extra?: { model?: string },
): AiConfig {
  const librettoConfig = readLibrettoConfig(configPath);
  const ai = AiConfigSchema.parse({
    preset,
    commandPrefix,
    ...extra,
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

export function clearAiConfig(configPath: string = LIBRETTO_CONFIG_PATH): boolean {
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
  console.log(`AI preset: ${config.preset}`);
  console.log(`Command prefix: ${formatCommandPrefix(config.commandPrefix)}`);
  if (config.model) console.log(`Model: ${config.model}`);
  console.log(`Config file: ${configPath}`);
  console.log(`Updated at: ${config.updatedAt}`);
}

function printConfigureUsage(commandName: string): void {
  console.log(
    `Usage: ${commandName} <${AI_CONFIG_PRESET_USAGE}>
       ${commandName}
       ${commandName} --clear`,
  );
}

function resolveAiConfigurePreset(
  presetArg: string | undefined,
): AiConfigurePresetResolution | null {
  switch (presetArg?.trim()) {
    case "codex":
      return { preset: "codex" };
    case "claude":
      return { preset: "claude" };
    case "gemini":
      return { preset: "gemini" };
    case "google-vertex-ai":
      return {
        preset: "gemini",
        model: "vertex/gemini-2.5-pro",
      };
    default:
      return null;
  }
}

export function runAiConfigure(
  input: {
    preset?: string;
    clear?: boolean;
    customPrefix?: string[];
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
      console.log(`No AI config set. Run '${configureCommandName} codex' to set one.`);
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

  const resolvedPreset = resolveAiConfigurePreset(presetArg);
  if (!resolvedPreset) {
    printConfigureUsage(configureCommandName);
    throw new Error(
      `Missing or invalid preset. Use one of: ${AI_CONFIG_PRESET_INPUTS.join(", ")}.`,
    );
  }

  const preset = resolvedPreset.preset;
  const presetDefaults = AI_CONFIG_PRESETS[preset];
  const customPrefix = input.customPrefix?.filter(Boolean);
  const commandPrefix =
    customPrefix && customPrefix.length > 0
      ? customPrefix
      : presetDefaults.commandPrefix;

  const config = writeAiConfig(preset, commandPrefix, configPath, {
    model: resolvedPreset.model ?? presetDefaults.model,
  });
  console.log("AI config saved.");
  if (presetArg === "google-vertex-ai") {
    console.log("Configured Google Vertex AI via the Gemini preset.");
  }
  printAiConfig(config, configPath);
}
