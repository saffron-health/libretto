import type { Argv } from "yargs";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  readAiConfig,
} from "../core/ai-config.js";
import { REPO_ROOT } from "../core/context.js";
import {
  SNAPSHOT_MODEL_ENV_VAR,
  loadSnapshotEnv,
  resolveSnapshotApiModel,
} from "../core/snapshot-api-config.js";
import { hasProviderCredentials } from "../../shared/llm/client.js";

type ProviderChoice = {
  key: string;
  label: string;
  envVar: string;
  envHint: string;
};

const PROVIDER_CHOICES: ProviderChoice[] = [
  {
    key: "1",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    envHint: "Get your key at https://platform.openai.com/api-keys",
  },
  {
    key: "2",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    envHint: "Get your key at https://console.anthropic.com/settings/keys",
  },
  {
    key: "3",
    label: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    envHint: "Get your key at https://aistudio.google.com/apikey",
  },
  {
    key: "4",
    label: "Google Vertex AI",
    envVar: "GOOGLE_CLOUD_PROJECT",
    envHint: "Requires gcloud auth application-default login and a GCP project ID",
  },
];

function promptUser(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function printSnapshotApiStatus(): void {
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
  console.log("    Run `npx libretto init` interactively to set up credentials.");
}

async function runInteractiveApiSetup(): Promise<void> {
  const config = readAiConfig();
  const selection = resolveSnapshotApiModel(config);
  const envPath = join(REPO_ROOT, ".env");

  console.log("\nSnapshot analysis setup:");
  console.log(
    "  Libretto uses direct API calls for snapshot analysis.",
  );
  console.log(`  Credentials are loaded from process env and ${envPath}.`);

  if (selection && hasProviderCredentials(selection.provider)) {
    console.log(
      `  \u2713 Ready: ${selection.model} (${selection.source})`,
    );
    console.log("    Snapshot objectives will use the API analyzer by default.");
    return;
  }

  console.log("  \u2717 No snapshot API credentials detected.\n");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("  Which API provider would you like to use for snapshot analysis?\n");
    for (const choice of PROVIDER_CHOICES) {
      console.log(`    ${choice.key}) ${choice.label}`);
    }
    console.log("    s) Skip for now\n");

    const answer = await promptUser(rl, "  Choice: ");

    if (answer.toLowerCase() === "s" || !answer) {
      console.log("\n  Skipped. You can set up API credentials later by rerunning `npx libretto init`.");
      console.log("  Or add credentials directly to your .env file:");
      console.log("    OPENAI_API_KEY=...");
      console.log("    ANTHROPIC_API_KEY=...");
      console.log("    GEMINI_API_KEY=...");
      console.log(
        `  Optional: set ${SNAPSHOT_MODEL_ENV_VAR}=provider/model-id to force a specific model.`,
      );
      return;
    }

    const selected = PROVIDER_CHOICES.find((c) => c.key === answer);
    if (!selected) {
      console.log(`\n  Unknown choice "${answer}". Skipping API setup.`);
      return;
    }

    console.log(`\n  ${selected.label} selected.`);
    console.log(`  ${selected.envHint}\n`);

    const apiKeyValue = await promptUser(rl, `  Enter your ${selected.envVar}: `);

    if (!apiKeyValue) {
      console.log("\n  No value entered. Skipping API key setup.");
      return;
    }

    // Write to .env file
    let envContent = "";
    if (existsSync(envPath)) {
      envContent = readFileSync(envPath, "utf-8");
    }

    const envLine = `${selected.envVar}=${apiKeyValue}`;
    if (envContent.includes(`${selected.envVar}=`)) {
      const updated = envContent.replace(
        new RegExp(`^${selected.envVar}=.*$`, "m"),
        () => envLine,
      );
      writeFileSync(envPath, updated);
      console.log(`\n  \u2713 Updated ${selected.envVar} in ${envPath}`);
    } else {
      const separator = envContent && !envContent.endsWith("\n") ? "\n" : "";
      appendFileSync(envPath, `${separator}${envLine}\n`);
      console.log(`\n  \u2713 Added ${selected.envVar} to ${envPath}`);
    }

    // Reload env and verify
    loadSnapshotEnv();
    process.env[selected.envVar] = apiKeyValue;
    const newSelection = resolveSnapshotApiModel(readAiConfig());
    if (newSelection && hasProviderCredentials(newSelection.provider)) {
      console.log(`  \u2713 Snapshot API ready: ${newSelection.model}`);
    }
  } finally {
    rl.close();
  }
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
    async (argv) => {
      console.log("Initializing libretto...\n");

      if (!argv["skip-browsers"]) {
        installBrowsers();
      } else {
        console.log("\nSkipping browser installation (--skip-browsers)");
      }

      // Interactive setup only when stdin is a TTY (real terminal).
      // In tests/CI/piped contexts, just print status.
      if (process.stdin.isTTY) {
        await runInteractiveApiSetup();
      } else {
        printSnapshotApiStatus();
      }

      console.log("\n\u2713 libretto init complete");
    },
  );
}
