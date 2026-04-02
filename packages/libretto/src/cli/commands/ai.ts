import { z } from "zod";
import {
  CURRENT_CONFIG_VERSION,
  readAiConfig,
  writeAiConfig,
  clearAiConfig,
  type AiConfig,
} from "../core/config.js";
import { LIBRETTO_CONFIG_PATH } from "../core/context.js";
import { SimpleCLI } from "../framework/simple-cli.js";

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

const CONFIGURE_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "vertex",
] as const;

function formatConfigureProviders(separator = " | "): string {
  return CONFIGURE_PROVIDERS.join(separator);
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
      console.log(
        "Provider credentials still come from your shell or .env file.",
      );
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

export const aiConfigureInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("preset", z.string().optional(), {
      help: "Provider shorthand or provider/model-id",
    }),
  ],
  named: {
    clear: SimpleCLI.flag({ help: "Clear existing AI config" }),
  },
});

export const aiCommands = SimpleCLI.group({
  description: "AI commands",
  routes: {
    configure: SimpleCLI.command({
      description: "Configure AI runtime",
    })
      .input(aiConfigureInput)
      .handle(async ({ input }) => {
        runAiConfigure(
          {
            clear: input.clear,
            preset: input.preset,
          },
          {
            configureCommandName: `libretto ai configure`,
          },
        );
      }),
  },
});
