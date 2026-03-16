import { createInterface } from "node:readline";
import { appendFileSync, cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAiConfig } from "../core/ai-config.js";
import { REPO_ROOT } from "../core/context.js";
import {
  loadSnapshotEnv,
  resolveSnapshotApiModel,
} from "../core/snapshot-api-config.js";
import { SimpleCLI } from "../framework/simple-cli.js";
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

function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function safeReadAiConfig(): ReturnType<typeof readAiConfig> {
  try {
    return readAiConfig();
  } catch {
    return null;
  }
}

function printSnapshotApiStatus(): void {
  const config = safeReadAiConfig();
  const selection = resolveSnapshotApiModel(config);
  const envPath = join(REPO_ROOT, ".env");

  console.log("\nSnapshot analysis:");
  console.log(
    "  Libretto uses direct API calls for snapshot analysis when supported credentials are available.",
  );
  console.log(`  Credentials are loaded from process env and ${envPath}.`);

  if (selection && hasProviderCredentials(selection.provider)) {
    console.log(`  ✓ Ready: ${selection.model} (${selection.source})`);
    console.log("    Snapshot objectives will use the API analyzer by default.");
    console.log("    No further action required.");
    return;
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
    "    Or run `npx libretto ai configure <provider>` to set a specific model.",
  );
  console.log("    Run `npx libretto init` interactively to set up credentials.");
}

async function runInteractiveApiSetup(): Promise<void> {
  const config = safeReadAiConfig();
  const selection = resolveSnapshotApiModel(config);
  const envPath = join(REPO_ROOT, ".env");

  console.log("\nSnapshot analysis setup:");
  console.log("  Libretto uses direct API calls for snapshot analysis.");
  console.log(`  Credentials are loaded from process env and ${envPath}.`);

  if (selection && hasProviderCredentials(selection.provider)) {
    console.log(`  ✓ Ready: ${selection.model} (${selection.source})`);
    console.log("    Snapshot objectives will use the API analyzer by default.");
    return;
  }

  console.log("  ✗ No snapshot API credentials detected.\n");

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
        "    Or run `npx libretto ai configure <provider>` to set a specific model.",
      );
      return;
    }

    const selected = PROVIDER_CHOICES.find((choice) => choice.key === answer);
    if (!selected) {
      console.log(`\n  Unknown choice "${answer}". Skipping API setup.`);
      return;
    }

    console.log(`\n  ${selected.label} selected.`);
    console.log(`  ${selected.envHint}\n`);

    const apiKeyValue = await promptUser(
      rl,
      `  Enter your ${selected.envVar}: `,
    );

    if (!apiKeyValue) {
      console.log("\n  No value entered. Skipping API key setup.");
      return;
    }

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
      console.log(`\n  ✓ Updated ${selected.envVar} in ${envPath}`);
    } else {
      const separator = envContent && !envContent.endsWith("\n") ? "\n" : "";
      appendFileSync(envPath, `${separator}${envLine}\n`);
      console.log(`\n  ✓ Added ${selected.envVar} to ${envPath}`);
    }

    loadSnapshotEnv();
    process.env[selected.envVar] = apiKeyValue;
    const newSelection = resolveSnapshotApiModel(safeReadAiConfig());
    if (newSelection && hasProviderCredentials(newSelection.provider)) {
      console.log(`  ✓ Snapshot API ready: ${newSelection.model}`);
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
    console.log("  ✓ Playwright Chromium installed");
  } else {
    console.error(
      "  ✗ Failed to install Playwright Chromium. Run manually: npx playwright install chromium",
    );
  }
}

function getPackageSkillsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // Walk up from dist/cli/commands/ to package root
  let dir = dirname(thisFile);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "skills", "libretto"))) {
      return join(dir, "skills", "libretto");
    }
    dir = dirname(dir);
  }
  throw new Error("Could not locate libretto skill files in package");
}

async function copySkills(): Promise<void> {
  const cwd = process.cwd();
  const agentDirs: { name: string; skillDest: string }[] = [];

  // Detect existing coding agent directories
  if (existsSync(join(cwd, ".agents"))) {
    agentDirs.push({
      name: ".agents",
      skillDest: join(cwd, ".agents", "skills", "libretto"),
    });
  }
  if (existsSync(join(cwd, ".claude"))) {
    agentDirs.push({
      name: ".claude",
      skillDest: join(cwd, ".claude", "skills", "libretto"),
    });
  }

  if (agentDirs.length === 0) {
    console.log("\nSkills: No .agents/ or .claude/ directory found — skipping skill copy.");
    return;
  }

  const dirNames = agentDirs.map((d) => d.name).join(" and ");
  // Say "Overwrite" if skills already exist in ANY target dir — skills must
  // be identical across coding agents, so we always copy to all of them.
  const existing = agentDirs.filter((d) => existsSync(d.skillDest));
  const verb = existing.length > 0 ? "Overwrite" : "Install";

  const proceed = await askYesNo(`\n${verb} libretto skills in ${dirNames}?`);
  if (!proceed) {
    console.log("  Skipping skill copy.");
    return;
  }

  let sourceDir: string;
  try {
    sourceDir = getPackageSkillsDir();
  } catch (e) {
    console.error(`  ✗ ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  for (const { name, skillDest } of agentDirs) {
    cpSync(sourceDir, skillDest, { recursive: true });
    const fileCount = readdirSync(skillDest).length;
    console.log(`  ✓ Copied ${fileCount} skill files to ${name}/skills/libretto/`);
  }
}

export const initInput = SimpleCLI.input({
  positionals: [],
  named: {
    skipBrowsers: SimpleCLI.flag({
      name: "skip-browsers",
      help: "Skip Playwright Chromium installation",
    }),
  },
});

export const initCommand = SimpleCLI.command({
  description: "Initialize libretto in the current project",
})
  .input(initInput)
  .handle(async ({ input }) => {
    console.log("Initializing libretto...\n");

    if (!input.skipBrowsers) {
      installBrowsers();
    } else {
      console.log("\nSkipping browser installation (--skip-browsers)");
    }

    if (process.stdin.isTTY) {
      await copySkills();
      await runInteractiveApiSetup();
    } else {
      printSnapshotApiStatus();
    }

    console.log("\n✓ libretto init complete");
  });
