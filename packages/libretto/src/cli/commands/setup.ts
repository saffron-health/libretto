import { createInterface } from "node:readline";
import {
  appendFileSync,
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAiConfig } from "../core/config.js";
import {
  ensureLibrettoSetup,
  LIBRETTO_CONFIG_PATH,
  REPO_ROOT,
} from "../core/context.js";
import {
  type AiSetupStatus,
  DEFAULT_SNAPSHOT_MODELS,
  loadSnapshotEnv,
  resolveAiSetupStatus,
} from "../core/ai-model.js";
import type { Provider } from "../core/resolve-model.js";
import { SimpleCLI } from "../framework/simple-cli.js";

export type ProviderChoice = {
  key: string;
  label: string;
  provider: Provider;
  envVar: string;
  envHint: string;
};

export const PROVIDER_CHOICES: ProviderChoice[] = [
  {
    key: "1",
    label: "OpenAI",
    provider: "openai",
    envVar: "OPENAI_API_KEY",
    envHint: "Get your key at https://platform.openai.com/api-keys",
  },
  {
    key: "2",
    label: "Anthropic",
    provider: "anthropic",
    envVar: "ANTHROPIC_API_KEY",
    envHint: "Get your key at https://console.anthropic.com/settings/keys",
  },
  {
    key: "3",
    label: "Google Gemini",
    provider: "google",
    envVar: "GEMINI_API_KEY",
    envHint: "Get your key at https://aistudio.google.com/apikey",
  },
  {
    key: "4",
    label: "Google Vertex AI",
    provider: "vertex",
    envVar: "GOOGLE_CLOUD_PROJECT",
    envHint:
      "Requires `gcloud auth application-default login` and a GCP project ID",
  },
];

function promptUser(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * If the workspace has usable credentials but no pinned model in config,
 * write the resolved default model to `.libretto/config.json`.
 */
function ensurePinnedDefaultModel(
  status: AiSetupStatus & { kind: "ready" },
): AiSetupStatus & { kind: "ready" } {
  if (status.source !== "config") {
    writeAiConfig(status.model);
    return { ...status, source: "config" as const };
  }
  return status;
}

function printHealthySummary(status: AiSetupStatus & { kind: "ready" }): void {
  console.log(`  ✓ Model: ${status.model}`);
  console.log(`  Config: ${LIBRETTO_CONFIG_PATH}`);
  console.log(
    "  To change: npx libretto ai configure openai | anthropic | gemini | vertex",
  );
}

function printInvalidAiConfigWarning(status: AiSetupStatus): void {
  if (status.kind !== "invalid-config") return;
  console.log("  ! Existing AI config is invalid:");
  for (const line of status.message.split("\n")) {
    console.log(`    ${line}`);
  }
}

// ── Repair plan helpers (exported for testing) ──────────────────────────────

export type RepairChoice =
  | "enter-matching-credential"
  | "switch-provider"
  | "skip";

export type RepairPlan =
  | {
      kind: "repair-missing-credentials";
      provider: Provider;
      model: string;
      envVar: string;
      choices: RepairChoice[];
    }
  | { kind: "repair-invalid-config"; message: string }
  | { kind: "no-repair-needed" };

/**
 * Determine what repair action setup should take for the current AI status.
 * Pure function — no I/O, no prompts.
 */
export function buildRepairPlan(status: AiSetupStatus): RepairPlan {
  if (status.kind === "configured-missing-credentials") {
    const choice = PROVIDER_CHOICES.find((c) => c.provider === status.provider);
    return {
      kind: "repair-missing-credentials",
      provider: status.provider,
      model: status.model,
      envVar: choice?.envVar ?? `${status.provider.toUpperCase()}_API_KEY`,
      choices: ["enter-matching-credential", "switch-provider", "skip"],
    };
  }
  if (status.kind === "invalid-config") {
    return { kind: "repair-invalid-config", message: status.message };
  }
  return { kind: "no-repair-needed" };
}

/**
 * Format a provider-specific explanation for missing credentials.
 */
export function formatMissingCredentialsMessage(
  plan: RepairPlan & { kind: "repair-missing-credentials" },
): string {
  return [
    `  ✗ ${plan.provider} is configured (model: ${plan.model}), but ${plan.envVar} is not set.`,
  ].join("\n");
}

function printSnapshotApiStatus(): boolean {
  const status = resolveAiSetupStatus();
  const envPath = join(REPO_ROOT, ".env");

  console.log("\nSnapshot analysis:");
  console.log(
    "  Libretto uses direct API calls for snapshot analysis when supported credentials are available.",
  );
  console.log(`  Credentials are loaded from process env and ${envPath}.`);

  if (status.kind === "ready") {
    const pinned = ensurePinnedDefaultModel(status);
    printHealthySummary(pinned);
    return true;
  }

  // Provider-specific missing-credentials message
  const plan = buildRepairPlan(status);
  if (plan.kind === "repair-missing-credentials") {
    console.log(formatMissingCredentialsMessage(plan));
    console.log(
      `    To fix: add ${plan.envVar} to .env, or run \`npx libretto setup\` interactively to repair.`,
    );
    return false;
  }

  if (plan.kind === "repair-invalid-config") {
    printInvalidAiConfigWarning(status);
    console.log("    Run `npx libretto setup` interactively to reconfigure.");
    return false;
  }

  console.log("  ✗ No snapshot API credentials detected.");
  console.log("    Add one provider to .env:");
  console.log("      OPENAI_API_KEY=...");
  console.log("      ANTHROPIC_API_KEY=...");
  console.log("      GEMINI_API_KEY=...  # or GOOGLE_GENERATIVE_AI_API_KEY");
  console.log(
    "      GOOGLE_CLOUD_PROJECT=...  # plus application default credentials for Vertex",
  );
  console.log(
    "    Or run `npx libretto ai configure openai | anthropic | gemini | vertex` to set a specific model.",
  );
  console.log(
    "    Run `npx libretto setup` interactively to set up credentials.",
  );
  return false;
}

/**
 * Write an env var to the .env file and update process.env.
 */
function writeEnvVar(envVar: string, value: string, envPath: string): void {
  let envContent = "";
  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, "utf-8");
  }

  const envLine = `${envVar}=${value}`;
  if (envContent.includes(`${envVar}=`)) {
    const updated = envContent.replace(
      new RegExp(`^${envVar}=.*$`, "m"),
      () => envLine,
    );
    writeFileSync(envPath, updated);
    console.log(`\n  ✓ Updated ${envVar} in ${envPath}`);
  } else {
    const separator = envContent && !envContent.endsWith("\n") ? "\n" : "";
    appendFileSync(envPath, `${separator}${envLine}\n`);
    console.log(`\n  ✓ Added ${envVar} to ${envPath}`);
  }

  process.env[envVar] = value;
}

/**
 * Prompt the user to enter a credential for a specific provider and pin its model.
 * When modelOverride is provided (e.g. during repair), preserves the existing model
 * instead of resetting to the provider default.
 * Returns true if credential was entered successfully.
 */
async function promptForCredential(
  rl: ReturnType<typeof createInterface>,
  choice: ProviderChoice,
  envPath: string,
  modelOverride?: string,
): Promise<boolean> {
  console.log(`\n  ${choice.label} selected.`);
  console.log(`  ${choice.envHint}\n`);

  const apiKeyValue = await promptUser(rl, `  Enter your ${choice.envVar}: `);

  if (!apiKeyValue) {
    console.log("\n  No value entered. Skipping API key setup.");
    return false;
  }

  writeEnvVar(choice.envVar, apiKeyValue, envPath);
  loadSnapshotEnv();

  const model = modelOverride ?? DEFAULT_SNAPSHOT_MODELS[choice.provider];
  writeAiConfig(model);
  console.log(`  ✓ Snapshot API ready: ${model}`);
  return true;
}

/**
 * Run the full provider selection menu and credential entry.
 * Returns true if a provider was successfully configured.
 */
async function promptProviderSelection(
  rl: ReturnType<typeof createInterface>,
  envPath: string,
): Promise<boolean> {
  console.log(
    "  Which API provider would you like to use for snapshot analysis?\n",
  );
  for (const choice of PROVIDER_CHOICES) {
    console.log(`    ${choice.key}) ${choice.label}`);
  }
  console.log("    s) Skip for now\n");

  const answer = await promptUser(rl, "  Choice: ");

  if (answer.toLowerCase() === "s" || !answer) {
    printSkipMessage();
    return false;
  }

  const selected = PROVIDER_CHOICES.find((choice) => choice.key === answer);
  if (!selected) {
    console.log(`\n  Unknown choice "${answer}". Skipping API setup.`);
    return false;
  }

  return promptForCredential(rl, selected, envPath);
}

function printSkipMessage(): void {
  console.log(
    "\n  Skipped. You can set up API credentials later by rerunning `npx libretto setup`.",
  );
  console.log("  Or add credentials directly to your .env file:");
  console.log("    OPENAI_API_KEY=...");
  console.log("    ANTHROPIC_API_KEY=...");
  console.log("    GEMINI_API_KEY=...");
  console.log(
    "    Or run `npx libretto ai configure openai | anthropic | gemini | vertex` to set a specific model.",
  );
}

async function runInteractiveApiSetup(): Promise<void> {
  const status = resolveAiSetupStatus();
  const envPath = join(REPO_ROOT, ".env");

  console.log("\nSnapshot analysis setup:");
  console.log("  Libretto uses direct API calls for snapshot analysis.");
  console.log(`  Credentials are loaded from process env and ${envPath}.`);

  if (status.kind === "ready") {
    const pinned = ensurePinnedDefaultModel(status);
    printHealthySummary(pinned);
    return;
  }

  const plan = buildRepairPlan(status);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // ── Repair: configured provider with missing credentials ──
    if (plan.kind === "repair-missing-credentials") {
      console.log(formatMissingCredentialsMessage(plan));
      console.log("");
      console.log("  How would you like to fix this?\n");
      console.log(`    1) Enter ${plan.envVar}`);
      console.log("    2) Switch to a different provider");
      console.log("    s) Skip for now\n");

      const answer = await promptUser(rl, "  Choice: ");

      if (answer === "1") {
        const matchingChoice = PROVIDER_CHOICES.find(
          (c) => c.provider === plan.provider,
        );
        if (matchingChoice) {
          await promptForCredential(rl, matchingChoice, envPath, plan.model);
        }
        return;
      }

      if (answer === "2") {
        await promptProviderSelection(rl, envPath);
        return;
      }

      // skip or empty
      printSkipMessage();
      return;
    }

    // ── Repair: invalid config → let user pick a provider ──
    if (plan.kind === "repair-invalid-config") {
      printInvalidAiConfigWarning(status);
      console.log(
        "\n  Would you like to reconfigure with a fresh provider selection?\n",
      );
      await promptProviderSelection(rl, envPath);
      return;
    }

    // ── Unconfigured: standard first-run flow ──
    console.log("  ✗ No snapshot API credentials detected.\n");
    await promptProviderSelection(rl, envPath);
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
    console.log("  ✓ Playwright Chromium installed");
  } else {
    console.error(
      "  ✗ Failed to install Playwright Chromium. Run manually: npx playwright install chromium",
    );
  }
}

function getPackageSkillsRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // Walk up from dist/cli/commands/ to package root
  let dir = dirname(thisFile);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "skills", "libretto"))) {
      return join(dir, "skills");
    }
    dir = dirname(dir);
  }
  throw new Error("Could not locate libretto skill files in package");
}

/**
 * Auto-detect .agents/ and .claude/ directories at a given root path.
 */
function detectAgentDirs(root: string): string[] {
  const dirs: string[] = [];
  if (existsSync(join(root, ".agents"))) dirs.push(join(root, ".agents"));
  if (existsSync(join(root, ".claude"))) dirs.push(join(root, ".claude"));
  return dirs;
}

function copySkills(): void {
  const agentDirs = detectAgentDirs(REPO_ROOT);

  if (agentDirs.length === 0) {
    console.log(
      "\nSkills: No .agents/ or .claude/ directory found in repo root — skipping.",
    );
    return;
  }

  let skillsRoot: string;
  try {
    skillsRoot = getPackageSkillsRoot();
  } catch (e) {
    console.error(`  ✗ ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const agentDir of agentDirs) {
    const agentName = basename(agentDir);

    for (const skillName of skillNames) {
      const sourceDir = join(skillsRoot, skillName);
      const skillDest = join(agentDir, "skills", skillName);
      if (existsSync(skillDest)) {
        rmSync(skillDest, { recursive: true });
      }
      cpSync(sourceDir, skillDest, { recursive: true });
      const fileCount = readdirSync(skillDest).length;
      console.log(
        `  ✓ Copied ${fileCount} skill files to ${agentName}/skills/${skillName}/`,
      );
    }
  }
}

export const setupInput = SimpleCLI.input({
  positionals: [],
  named: {
    skipBrowsers: SimpleCLI.flag({
      name: "skip-browsers",
      help: "Skip Playwright Chromium installation",
    }),
  },
});

export const setupCommand = SimpleCLI.command({
  description: "Set up libretto in the current project",
})
  .input(setupInput)
  .handle(async ({ input }) => {
    console.log("Setting up libretto...\n");
    ensureLibrettoSetup();

    if (!input.skipBrowsers) {
      installBrowsers();
    } else {
      console.log("\nSkipping browser installation (--skip-browsers)");
    }

    copySkills();

    if (process.stdin.isTTY) {
      await runInteractiveApiSetup();
    } else {
      const ready = printSnapshotApiStatus();
      if (!ready) {
        console.log(
          "\nIf you're an agent, request the user to run `npx libretto setup`.",
        );
      }
    }

    console.log("\n✓ libretto setup complete");
  });
