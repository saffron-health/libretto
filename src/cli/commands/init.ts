import type { Argv } from "yargs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  formatCommandPrefix,
  isDefaultCommandPrefixForPreset,
  readAiConfig,
} from "../core/ai-config.js";
import { REPO_ROOT } from "../core/context.js";
import {
  SNAPSHOT_MODEL_ENV_VAR,
  resolveSnapshotApiModel,
} from "../core/snapshot-api-config.js";
import { hasProviderCredentials } from "../../shared/llm/client.js";

function printSnapshotApiSetup(): void {
  const config = readAiConfig();
  const selection = resolveSnapshotApiModel(config);
  const envPath = join(REPO_ROOT, ".env");

  console.log("\nSnapshot analysis:");
  console.log(
    "  Libretto uses direct API calls for snapshot analysis when supported credentials are available.",
  );
  console.log(`  Credentials are loaded from process env and ${envPath}.`);

  if (selection && hasProviderCredentials(selection.provider)) {
    console.log(
      `  \u2713 Ready: ${selection.model} (${selection.source})`,
    );
    console.log("    Snapshot objectives will use the API analyzer by default.");
    console.log("    No further action required.");
    return;
  }

  console.log("  \u2717 No snapshot API credentials detected.");
  console.log("    Add one provider to .env:");
  console.log("      OPENAI_API_KEY=...");
  console.log("      ANTHROPIC_API_KEY=...");
  console.log("      GEMINI_API_KEY=...  # or GOOGLE_GENERATIVE_AI_API_KEY");
  console.log(
    "      GOOGLE_CLOUD_PROJECT=...  # plus application default credentials for Vertex",
  );
  console.log(
    `    Optional: set ${SNAPSHOT_MODEL_ENV_VAR}=provider/model-id to force a specific model.`,
  );
  console.log("    Next: rerun `npx libretto init` after adding credentials.");
}

function printCliFallbackSetup(): void {
  const config = readAiConfig();

  console.log("\nCLI analyzer fallback:");
  if (!config) {
    console.log("  No custom CLI analyzer configured.");
    console.log(
      "  Optional: run `npx libretto ai configure <codex|claude|gemini>` to set one up.",
    );
    return;
  }

  const mode = isDefaultCommandPrefixForPreset(config) ? "built-in preset" : "custom";
  console.log(
    `  \u2713 Configured (${mode}, ${config.preset}): ${formatCommandPrefix(config.commandPrefix)}`,
  );
  console.log(
    "    Libretto will use this analyzer when the API path is unavailable or when you intentionally configure a custom analyzer workflow.",
  );
}

function installBrowsers(): void {
  console.log("\nInstalling Playwright Chromium...");
  const result = spawnSync("npx", ["playwright", "install", "chromium"], {
    stdio: "inherit",
    shell: true,
  });
  if (result.status === 0) {
    console.log("  \u2713 Playwright Chromium installed");
  } else {
    console.error(
      "  \u2717 Failed to install Playwright Chromium. Run manually: npx playwright install chromium",
    );
  }
}

export function registerInitCommand(yargs: Argv): Argv {
  return yargs.command(
    "init",
    "Initialize libretto in the current project",
    (cmd) =>
      cmd.option("skip-browsers", {
        type: "boolean",
        default: false,
        describe: "Skip Playwright Chromium installation",
      }),
    (argv) => {
      console.log("Initializing libretto...\n");

      if (!argv["skip-browsers"]) {
        installBrowsers();
      } else {
        console.log("\nSkipping browser installation (--skip-browsers)");
      }

      printSnapshotApiSetup();
      printCliFallbackSetup();

      console.log("\n\u2713 libretto init complete");
    },
  );
}
