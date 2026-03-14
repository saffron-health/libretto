import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { LIBRETTO_CONFIG_PATH } from "./context.js";

export const CURRENT_CONFIG_VERSION = 1;

export const AiPresetSchema = z.enum(["codex", "claude", "gemini"]);
export type AiPreset = z.infer<typeof AiPresetSchema>;

export const AiConfigSchema = z
  .object({
    preset: AiPresetSchema,
    commandPrefix: z.array(z.string()).min(1),
    /** Model override for the sub-agent session (e.g. "claude-sonnet-4-6", "o4-mini"). */
    model: z.string().optional(),
    /**
     * Reasoning / thinking configuration.
     * - Claude: passed as --thinking-budget <number>
     * - Codex:  passed as --reasoning-effort <"low"|"medium"|"high">
     */
    reasoning: z.union([z.string(), z.number()]).optional(),
    /**
     * Restrict which tools the sub-agent session can use.
     * - Claude: passed as --tools "Read,Grep,Glob"
     * - Codex:  enforced via --sandbox (read-only already in default preset)
     * - Gemini: not supported (ignored)
     */
    allowedTools: z.array(z.string()).optional(),
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
    allowedTools: ["Read", "Grep", "Glob"],
  },
  gemini: {
    preset: "gemini",
    commandPrefix: ["gemini", "--sandbox", "--yolo", "--output-format", "json"],
    allowedTools: ["read_file", "list_directory", "search_file_content", "glob"],
  },
};

function arrayShallowEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length
    && left.every((value, index) => value === right[index])
  );
}

export function isDefaultCommandPrefixForPreset(config: AiConfig): boolean {
  return arrayShallowEqual(
    config.commandPrefix,
    AI_CONFIG_PRESETS[config.preset].commandPrefix,
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
  extra?: { model?: string; reasoning?: string | number; allowedTools?: string[] },
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
  // Keep all config fields except AI state.
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
  if (config.reasoning !== undefined) console.log(`Reasoning: ${config.reasoning}`);
  if (config.allowedTools?.length) console.log(`Allowed tools: ${config.allowedTools.join(", ")}`);
  console.log(`Config file: ${configPath}`);
  console.log(`Updated at: ${config.updatedAt}`);
}

function printConfigureUsage(commandName: string): void {
  console.log(
    `Usage: ${commandName} <codex|claude|gemini> [-- <command prefix...>]
       ${commandName}
       ${commandName} --clear`,
  );
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
    options.configureCommandName ?? "libretto-cli ai configure";
  const configPath = options.configPath ?? LIBRETTO_CONFIG_PATH;

  const presetArg = input.preset?.trim();
  const customPrefix = (input.customPrefix ?? []).filter(Boolean);

  if (!presetArg && customPrefix.length === 0 && !input.clear) {
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

  const parsedPreset = AiPresetSchema.safeParse(presetArg);
  if (!parsedPreset.success) {
    printConfigureUsage(configureCommandName);
    throw new Error(
      "Missing or invalid preset. Use one of: codex, claude, gemini.",
    );
  }

  if (input.customPrefix && input.customPrefix.length > 0 && customPrefix.length === 0) {
    throw new Error("Custom command prefix cannot be empty.");
  }

  const preset = parsedPreset.data;
  const presetDefaults = AI_CONFIG_PRESETS[preset];
  const commandPrefix =
    customPrefix.length > 0
      ? customPrefix
      : presetDefaults.commandPrefix;

  const config = writeAiConfig(preset, commandPrefix, configPath, {
    model: presetDefaults.model,
    reasoning: presetDefaults.reasoning,
    allowedTools: presetDefaults.allowedTools,
  });
  console.log("AI config saved.");
  printAiConfig(config, configPath);
}
