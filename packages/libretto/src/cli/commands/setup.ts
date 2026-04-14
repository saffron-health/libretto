import { createInterface } from "node:readline";
import {
  cpSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSnapshotModel } from "../core/config.js";
import {
  ensureLibrettoSetup,
  LIBRETTO_CONFIG_PATH,
  REPO_ROOT,
} from "../core/context.js";
import {
  type AiSetupStatus,
  DEFAULT_SNAPSHOT_MODELS,
  resolveAiSetupStatus,
} from "../core/ai-model.js";
import type { Provider } from "../core/resolve-model.js";
import { SimpleCLI } from "../framework/simple-cli.js";

const PROVIDER_SDK_PACKAGES: Record<Provider, string> = {
  openai: "@ai-sdk/openai",
  anthropic: "@ai-sdk/anthropic",
  google: "@ai-sdk/google",
  vertex: "@ai-sdk/google-vertex",
};

function detectPackageManager(): string {
  if (existsSync(join(REPO_ROOT, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(REPO_ROOT, "yarn.lock"))) return "yarn";
  if (existsSync(join(REPO_ROOT, "bun.lockb"))) return "bun";
  return "npm";
}

function installCommand(pkgManager: string): string {
  switch (pkgManager) {
    case "yarn":
      return "yarn add";
    case "bun":
      return "bun add";
    case "pnpm":
      return "pnpm add";
    default:
      return "npm install";
  }
}

function isSdkInstalled(sdkPackage: string): boolean {
  try {
    const result = spawnSync("node", ["-e", `require.resolve("${sdkPackage}")`], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function installSdkIfNeeded(provider: Provider): void {
  const sdkPackage = PROVIDER_SDK_PACKAGES[provider];
  if (isSdkInstalled(sdkPackage)) return;

  const pkgManager = detectPackageManager();
  const cmd = installCommand(pkgManager);
  console.log(`\nInstalling ${sdkPackage}...`);
  const result = spawnSync(cmd, [sdkPackage], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
  });
  if (result.status === 0) {
    console.log(`✓ Installed ${sdkPackage}`);
  } else {
    console.error(
      `✗ Failed to install ${sdkPackage}. Install it manually: ${cmd} ${sdkPackage}`,
    );
  }
}

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

/** Map provider to a human-readable label for status messages. */
function providerLabel(provider: Provider): string {
  const choice = PROVIDER_CHOICES.find((c) => c.provider === provider);
  return choice?.label ?? provider;
}

/** Extract the env var name from source like "env:GOOGLE_CLOUD_PROJECT". */
function sourceEnvVar(source: string): string | null {
  if (source.startsWith("env:")) return source.slice(4);
  return null;
}

/**
 * If the workspace has usable credentials but no pinned model in config,
 * write the resolved default model to `.libretto/config.json`.
 */
function ensurePinnedDefaultModel(
  status: AiSetupStatus & { kind: "ready" },
): AiSetupStatus & { kind: "ready" } {
  if (status.source !== "config") {
    writeSnapshotModel(status.model);
    return { ...status, source: "config" as const };
  }
  return status;
}

function printHealthySummary(status: AiSetupStatus & { kind: "ready" }): void {
  const envVar = sourceEnvVar(status.source);
  if (envVar) {
    console.log(
      `✓ Detected ${envVar}. Using ${providerLabel(status.provider)}.`,
    );
  } else {
    console.log(`✓ Using ${providerLabel(status.provider)} (${status.model}).`);
  }
  console.log(
    "To change: npx libretto ai configure openai | anthropic | gemini | vertex",
  );
}

function printInvalidAiConfigWarning(status: AiSetupStatus): void {
  if (status.kind !== "invalid-config") return;
  console.log("! Existing AI config is invalid:");
  for (const line of status.message.split("\n")) {
    console.log(`  ${line}`);
  }
}

// ── Repair plan helpers (exported for testing) ──────────────────────────────

export type RepairChoice = "switch-provider" | "skip";

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
      choices: ["switch-provider", "skip"],
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
  return `✗ ${plan.provider} is configured (model: ${plan.model}), but ${plan.envVar} is not set.`;
}

function printSnapshotApiStatus(): boolean {
  const status = resolveAiSetupStatus();

  console.log(
    "\nLibretto uses a sub-agent to analyze DOM snapshots. The model is determined by environment variables.",
  );

  if (status.kind === "ready") {
    console.log();
    printHealthySummary(status);
    ensurePinnedDefaultModel(status);
    return true;
  }

  // Provider-specific missing-credentials message
  const plan = buildRepairPlan(status);
  if (plan.kind === "repair-missing-credentials") {
    console.log();
    console.log(formatMissingCredentialsMessage(plan));
    console.log(
      `  To fix: add ${plan.envVar} to .env, or run \`npx libretto setup\` interactively to repair.`,
    );
    return false;
  }

  if (plan.kind === "repair-invalid-config") {
    printInvalidAiConfigWarning(status);
    console.log("  Run `npx libretto setup` interactively to reconfigure.");
    return false;
  }

  console.log();
  console.log("✗ No snapshot API credentials detected.");
  console.log("  Add one provider to .env:");
  console.log("    OPENAI_API_KEY=...");
  console.log("    ANTHROPIC_API_KEY=...");
  console.log("    GEMINI_API_KEY=...  # or GOOGLE_GENERATIVE_AI_API_KEY");
  console.log(
    "    GOOGLE_CLOUD_PROJECT=...  # plus application default credentials for Vertex",
  );
  console.log(
    "  Or run `npx libretto ai configure openai | anthropic | gemini | vertex` to set a specific model.",
  );
  console.log(
    "  Run `npx libretto setup` interactively to set up credentials.",
  );
  return false;
}

/**
 * Run the full provider selection menu.
 * Pins the selected provider's default model to config and prints
 * instructions for the user to add the credential to .env themselves.
 * Returns true if a provider was successfully configured.
 */
async function promptProviderSelection(
  rl: ReturnType<typeof createInterface>,
): Promise<boolean> {
  console.log(
    "Which model provider would you like to use for snapshot analysis?\n",
  );
  for (const choice of PROVIDER_CHOICES) {
    console.log(`  ${choice.key}) ${choice.label}`);
  }
  console.log("  s) Skip for now\n");

  const answer = await promptUser(rl, "Choice: ");

  if (answer.toLowerCase() === "s" || !answer) {
    printSkipMessage();
    return false;
  }

  const selected = PROVIDER_CHOICES.find((choice) => choice.key === answer);
  if (!selected) {
    console.log(`\nUnknown choice "${answer}". Skipping API setup.`);
    return false;
  }

  const model = DEFAULT_SNAPSHOT_MODELS[selected.provider];
  writeSnapshotModel(model);
  console.log(`\n✓ ${selected.label} selected (model: ${model}).`);
  console.log(`\nAdd ${selected.envVar} to your .env file:`);
  console.log(`  ${selected.envHint}`);
  installSdkIfNeeded(selected.provider);
  return true;
}

function printSkipMessage(): void {
  console.log(
    "\nSkipped. You can set up API credentials later by rerunning `npx libretto setup`.",
  );
  console.log("Or add credentials directly to your .env file:");
  console.log("  OPENAI_API_KEY=...");
  console.log("  ANTHROPIC_API_KEY=...");
  console.log("  GEMINI_API_KEY=...");
  console.log(
    "  Or run `npx libretto ai configure openai | anthropic | gemini | vertex` to set a specific model.",
  );
}

async function runInteractiveApiSetup(): Promise<void> {
  const status = resolveAiSetupStatus();

  console.log(
    "\nLibretto uses a sub-agent to analyze DOM snapshots. The model is determined by environment variables.",
  );

  if (status.kind === "ready") {
    console.log();
    printHealthySummary(status);
    ensurePinnedDefaultModel(status);
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
      console.log(`\nAdd ${plan.envVar} to your .env file to fix this.`);
      console.log("");
      console.log("Or switch to a different provider:\n");
      console.log("  1) Switch to a different provider");
      console.log("  s) Skip for now\n");

      const answer = await promptUser(rl, "Choice: ");

      if (answer === "1") {
        await promptProviderSelection(rl);
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
        "\nWould you like to reconfigure with a fresh provider selection?\n",
      );
      await promptProviderSelection(rl);
      return;
    }

    // ── Unconfigured: standard first-run flow ──
    console.log("✗ No snapshot API credentials detected.\n");
    await promptProviderSelection(rl);
  } finally {
    rl.close();
  }
}

function installBrowsers(): void {
  console.log("Installing Playwright Chromium...");
  const result = spawnSync("npx", ["playwright", "install", "chromium"], {
    stdio: "inherit",
    shell: true,
  });
  if (result.status === 0) {
    console.log("✓ Playwright Chromium installed");
  } else {
    console.error(
      "✗ Failed to install Playwright Chromium. Run manually: npx playwright install chromium",
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
      "\n⚠️ No .agents/ or .claude/ directory found. Libretto skills were not installed.",
    );
    console.log(
      "  Create one of these directories in your repo root and rerun `npx libretto setup` to install skills:",
    );
    console.log(`    mkdir ${join(REPO_ROOT, ".claude")}`);
    return;
  }

  let skillsRoot: string;
  try {
    skillsRoot = getPackageSkillsRoot();
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
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
        `✓ Copied ${fileCount} skill files to ${agentName}/skills/${skillName}/`,
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
    ensureLibrettoSetup();

    if (!input.skipBrowsers) {
      installBrowsers();
    } else {
      console.log("Skipping browser installation (--skip-browsers)");
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

    console.log(`\nConfig set up at ${LIBRETTO_CONFIG_PATH}`);
    console.log("\n✓ libretto setup complete");
  });
