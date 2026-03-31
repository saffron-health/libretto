import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface, type Interface } from "node:readline";
import { dirname, join, resolve } from "node:path";

type Provider = "openai" | "anthropic" | "google" | "vertex";

type SnapshotSelection = {
  model: string;
  provider: Provider;
  source: "config" | `env:auto-${Provider}`;
};

const PROVIDER_CHOICES = [
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
    envHint:
      "Requires gcloud auth application-default login and a GCP project ID",
  },
] as const;

const DEFAULT_SNAPSHOT_MODELS = {
  openai: "openai/gpt-5.4",
  anthropic: "anthropic/claude-sonnet-4-6",
  google: "google/gemini-3-flash-preview",
  vertex: "vertex/gemini-2.5-pro",
} as const;

function readJsonFileIfExists<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readWorktreeEnvPath(repoRoot: string): string | null {
  const gitPath = join(repoRoot, ".git");
  if (!existsSync(gitPath)) return null;

  try {
    const gitPointer = readFileSync(gitPath, "utf-8").trim();
    const match = gitPointer.match(/^gitdir:\s*(.+)$/i);
    if (!match?.[1]) return null;
    const worktreeGitDir = resolve(repoRoot, match[1].trim());
    const commonGitDir = resolve(worktreeGitDir, "..", "..");
    return join(dirname(commonGitDir), ".env");
  } catch {
    return null;
  }
}

function promptUser(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export function parseDotEnvAssignment(
  line: string,
): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const withoutExport = trimmed.startsWith("export ")
    ? trimmed.slice("export ".length).trimStart()
    : trimmed;
  const eqIdx = withoutExport.indexOf("=");
  if (eqIdx < 1) return null;

  const key = withoutExport.slice(0, eqIdx).trim();
  if (!key) return null;

  const rawValue = withoutExport.slice(eqIdx + 1).trimStart();
  if (!rawValue) {
    return { key, value: "" };
  }

  if (rawValue.startsWith('"')) {
    const closeIdx = rawValue.indexOf('"', 1);
    if (closeIdx > 0) {
      return { key, value: rawValue.slice(1, closeIdx) };
    }
    return { key, value: rawValue.slice(1) };
  }

  if (rawValue.startsWith("'")) {
    const closeIdx = rawValue.indexOf("'", 1);
    if (closeIdx > 0) {
      return { key, value: rawValue.slice(1, closeIdx) };
    }
    return { key, value: rawValue.slice(1) };
  }

  const inlineCommentIndex = rawValue.search(/\s#/);
  const value =
    inlineCommentIndex >= 0
      ? rawValue.slice(0, inlineCommentIndex).trimEnd()
      : rawValue.trim();
  return { key, value };
}

export function loadSnapshotEnv(repoRoot: string): void {
  if (process.env.LIBRETTO_DISABLE_DOTENV?.trim() === "1") return;

  const envPathCandidates = [
    join(repoRoot, ".env"),
    readWorktreeEnvPath(repoRoot),
  ].filter((value): value is string => Boolean(value));

  const envPath = envPathCandidates.find((candidate) => existsSync(candidate));
  if (!envPath) return;

  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const parsed = parseDotEnvAssignment(line);
    if (!parsed) continue;
    if (!(parsed.key in process.env)) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

export function hasProviderCredentials(provider: Provider): boolean {
  switch (provider) {
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY?.trim());
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
    case "google":
      return Boolean(
        process.env.GEMINI_API_KEY?.trim() ||
          process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim(),
      );
    case "vertex":
      return Boolean(
        process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
          process.env.GCLOUD_PROJECT?.trim(),
      );
  }
}

type AiConfig = {
  model: string;
  updatedAt?: string;
};

function readAiConfig(repoRoot: string): AiConfig | null {
  const configPath = join(repoRoot, ".libretto", "config.json");
  const config = readJsonFileIfExists<Record<string, unknown>>(configPath);
  if (!config) return null;
  if (typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`AI config is invalid at ${configPath}: expected a JSON object.`);
  }

  const ai = config.ai;
  if (ai == null) {
    return null;
  }

  if (typeof ai !== "object" || Array.isArray(ai)) {
    throw new Error(`AI config is invalid at ${configPath}: expected "ai" to be an object.`);
  }

  const model = (ai as Record<string, unknown>).model;
  if (typeof model !== "string" || model.trim().length === 0) {
    throw new Error(
      `AI config is invalid at ${configPath}: expected "ai.model" to be a non-empty string.`,
    );
  }

  const updatedAt = (ai as Record<string, unknown>).updatedAt;
  return {
    model,
    updatedAt: typeof updatedAt === "string" ? updatedAt : undefined,
  };
}

function safeReadAiConfig(repoRoot: string): AiConfig | null {
  try {
    return readAiConfig(repoRoot);
  } catch {
    return null;
  }
}

function printInvalidAiConfigWarning(repoRoot: string): void {
  try {
    readAiConfig(repoRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("  ! Existing AI config is invalid:");
    for (const line of message.split("\n")) {
      console.log(`    ${line}`);
    }
  }
}

function providerFromModel(model: string): Provider | null {
  if (model.startsWith("openai/")) return "openai";
  if (model.startsWith("anthropic/")) return "anthropic";
  if (model.startsWith("google/")) return "google";
  if (model.startsWith("vertex/")) return "vertex";
  return null;
}

export function resolveSnapshotApiModel(
  repoRoot: string,
): SnapshotSelection | null {
  loadSnapshotEnv(repoRoot);

  const config = safeReadAiConfig(repoRoot);
  if (config?.model) {
    const provider = providerFromModel(config.model);
    if (provider) {
      return {
        model: config.model,
        provider,
        source: "config",
      };
    }
  }

  const providersInPriorityOrder: Provider[] = [
    "openai",
    "anthropic",
    "google",
    "vertex",
  ];

  for (const provider of providersInPriorityOrder) {
    if (!hasProviderCredentials(provider)) continue;
    return {
      model: DEFAULT_SNAPSHOT_MODELS[provider],
      provider,
      source: `env:auto-${provider}`,
    };
  }

  return null;
}

export function printSnapshotApiStatus(repoRoot: string): void {
  const selection = resolveSnapshotApiModel(repoRoot);
  const envPath = join(repoRoot, ".env");

  console.log("\nSnapshot analysis:");
  console.log(
    "  Libretto uses direct API calls for snapshot analysis when supported credentials are available.",
  );
  console.log(`  Credentials are loaded from process env and ${envPath}.`);
  printInvalidAiConfigWarning(repoRoot);

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
    "    Or run `npx libretto ai configure openai | anthropic | gemini | vertex` to set a specific model.",
  );
  console.log("    Run `npx libretto setup` interactively to set up credentials.");
}

export async function runInteractiveApiSetup(repoRoot: string): Promise<void> {
  const selection = resolveSnapshotApiModel(repoRoot);
  const envPath = join(repoRoot, ".env");

  console.log("\nSnapshot analysis setup:");
  console.log("  Libretto uses direct API calls for snapshot analysis.");
  console.log(`  Credentials are loaded from process env and ${envPath}.`);
  printInvalidAiConfigWarning(repoRoot);

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
    console.log(
      "  Which API provider would you like to use for snapshot analysis?\n",
    );
    for (const choice of PROVIDER_CHOICES) {
      console.log(`    ${choice.key}) ${choice.label}`);
    }
    console.log("    s) Skip for now\n");

    const answer = await promptUser(rl, "  Choice: ");

    if (answer.toLowerCase() === "s" || !answer) {
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

    process.env[selected.envVar] = apiKeyValue;
    const newSelection = resolveSnapshotApiModel(repoRoot);
    if (newSelection && hasProviderCredentials(newSelection.provider)) {
      console.log(`  ✓ Snapshot API ready: ${newSelection.model}`);
    }
  } finally {
    rl.close();
  }
}
