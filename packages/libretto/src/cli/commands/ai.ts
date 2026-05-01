import { z } from "zod";
import {
  CURRENT_CONFIG_VERSION,
  readSnapshotModel,
  writeSnapshotModel,
  clearSnapshotModel,
} from "../core/config.js";
import { LIBRETTO_CONFIG_PATH } from "../core/context.js";
import { DEFAULT_SNAPSHOT_MODELS } from "../core/ai-model.js";
import { librettoCommand } from "../core/package-manager.js";
import { SimpleCLI } from "../framework/simple-cli.js";

const PROVIDER_ALIASES: Record<string, string> = {
  claude: DEFAULT_SNAPSHOT_MODELS.anthropic,
  gemini: DEFAULT_SNAPSHOT_MODELS.google,
  google: DEFAULT_SNAPSHOT_MODELS.google,
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

function printSnapshotModelConfig(model: string, configPath: string): void {
  console.log(`Snapshot model: ${model}`);
  console.log(`Config file: ${configPath}`);
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
  return (
    (DEFAULT_SNAPSHOT_MODELS as Record<string, string>)[normalized] ??
    PROVIDER_ALIASES[normalized] ??
    null
  );
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
    options.configureCommandName ?? librettoCommand("ai configure");
  const configPath = options.configPath ?? LIBRETTO_CONFIG_PATH;

  const presetArg = input.preset?.trim();

  if (!presetArg && !input.clear) {
    const model = readSnapshotModel(configPath);
    if (!model) {
      console.log(
        `No snapshot model set. Choose a default model: ${configureCommandName} ${formatConfigureProviders()}`,
      );
      console.log(
        "Provider credentials still come from your shell or .env file.",
      );
      return;
    }
    printSnapshotModelConfig(model, configPath);
    return;
  }

  if (input.clear) {
    const removed = clearSnapshotModel(configPath);
    if (removed) {
      console.log(`Cleared snapshot model config: ${configPath}`);
    } else {
      console.log("No snapshot model was set.");
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

  writeSnapshotModel(model, configPath);
  console.log("Snapshot model saved.");
  printSnapshotModelConfig(model, configPath);
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
            configureCommandName: librettoCommand("ai configure"),
          },
        );
      }),
  },
});
