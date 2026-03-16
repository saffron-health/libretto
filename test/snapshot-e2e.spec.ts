import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

/**
 * End-to-end snapshot tests.
 *
 * Tests cover:
 * - Snapshot analysis via each supported API provider (OpenAI, Anthropic, Gemini, Vertex).
 *
 * Requirements:
 * - API keys for each provider in .env (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, GOOGLE_CLOUD_PROJECT).
 * - Network access to the target sites.
 * - Playwright Chromium installed.
 * - Saved profile in .libretto/profiles/linkedin.com.json for authenticated LinkedIn test.
 */

const SNAPSHOT_TIMEOUT = 180_000;
const PAGE_SETTLE_MS = 15_000;

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
] as const;

/** Load API keys from repo root .env so the CLI subprocess can use them. */
function loadEnvFile(): Record<string, string> {
  const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  const envPath = resolve(repoRoot, ".env");
  const env: Record<string, string> = {};
  if (!existsSync(envPath)) return env;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

const dotEnv = loadEnvFile();

/** Build env that forwards only the specified keys (from .env and process.env). */
function buildProviderEnv(...keys: string[]): Record<string, string> {
  const env: Record<string, string> = { LIBRETTO_DISABLE_DOTENV: "1" };
  for (const key of keys) {
    const value = dotEnv[key] || process.env[key];
    if (value) env[key] = value;
  }
  // Blank out all other provider keys so auto-detection picks the right one
  for (const key of ENV_KEYS) {
    if (!(key in env)) env[key] = "";
  }
  return env;
}

/** All keys forwarded so auto-detection can pick whichever is available. */
const allProviderEnv = buildProviderEnv(...ENV_KEYS);

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const LINKEDIN_SELECTOR_ASSERTION =
  "The output identifies CSS selectors for post content text AND poster names. " +
  "Specifically: (1) post content should use a data-testid attribute or similar robust selector, " +
  "(2) poster names should target elements within feed list items, " +
  "(3) all selectors must reference real HTML attributes visible in a LinkedIn feed page.";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const linkedinProfilePath = resolve(repoRoot, ".libretto/profiles/linkedin.com.json");
const hasLinkedInProfile = existsSync(linkedinProfilePath);

type ProviderTestConfig = {
  name: string;
  model: string;
  envKeys: string[];
};

const PROVIDERS: ProviderTestConfig[] = [
  {
    name: "OpenAI",
    model: "openai/gpt-5.4",
    envKeys: ["OPENAI_API_KEY"],
  },
  {
    name: "Anthropic",
    model: "anthropic/claude-sonnet-4-6",
    envKeys: ["ANTHROPIC_API_KEY"],
  },
  {
    name: "Google Gemini",
    model: "google/gemini-2.5-flash",
    envKeys: ["GEMINI_API_KEY"],
  },
  {
    name: "Google Vertex AI",
    model: "vertex/gemini-2.5-pro",
    envKeys: ["GOOGLE_CLOUD_PROJECT"],
  },
];

function hasProviderKeys(config: ProviderTestConfig): boolean {
  return config.envKeys.some((key) => Boolean(dotEnv[key] || process.env[key]));
}

describe("snapshot e2e – live site analysis", () => {
  test(
    "linkedin feed: identifies selectors (auto-detected provider)",
    async ({ librettoCli, evaluate, seedProfile }) => {
      const session = "snapshot-e2e-linkedin-auto";

      if (hasLinkedInProfile) {
        await seedProfile("linkedin.com", linkedinProfilePath);
      }

      await librettoCli(
        `open https://www.linkedin.com/feed/ --headless --session ${session}`,
      );

      await sleep(PAGE_SETTLE_MS);

      const snapshotStart = Date.now();
      const snapshot = await librettoCli(
        `snapshot --session ${session} --objective "Identify CSS selectors for: (1) individual post content text and (2) the name of the poster for each post in the LinkedIn feed."`,
        allProviderEnv,
      );
      const snapshotDurationMs = Date.now() - snapshotStart;

      await librettoCli(`close --session ${session}`);

      const output = snapshot.stdout + "\n" + snapshot.stderr;

      console.log(`[linkedin/auto] snapshot took ${snapshotDurationMs}ms`);
      console.log(`[linkedin/auto] output:\n${output}`);

      await evaluate(output).toMatch(LINKEDIN_SELECTOR_ASSERTION);
    },
    SNAPSHOT_TIMEOUT,
  );

  for (const provider of PROVIDERS) {
    const skip = !hasProviderKeys(provider);

    test(
      `linkedin feed: identifies selectors via ${provider.name}`,
      async ({ librettoCli, evaluate, seedProfile }) => {
        if (skip) {
          console.log(`[linkedin/${provider.name}] skipped: missing ${provider.envKeys.join(", ")}`);
          return;
        }

        const session = `snapshot-e2e-linkedin-${provider.name.toLowerCase().replace(/\s+/g, "-")}`;

        if (hasLinkedInProfile) {
          await seedProfile("linkedin.com", linkedinProfilePath);
        }

        // Configure the specific model via ai configure
        await librettoCli(`ai configure ${provider.model}`);

        await librettoCli(
          `open https://www.linkedin.com/feed/ --headless --session ${session}`,
        );

        await sleep(PAGE_SETTLE_MS);

        const providerEnv = buildProviderEnv(...provider.envKeys);

        const snapshotStart = Date.now();
        const snapshot = await librettoCli(
          `snapshot --session ${session} --objective "Identify CSS selectors for: (1) individual post content text and (2) the name of the poster for each post in the LinkedIn feed."`,
          providerEnv,
        );
        const snapshotDurationMs = Date.now() - snapshotStart;

        await librettoCli(`close --session ${session}`);

        const output = snapshot.stdout + "\n" + snapshot.stderr;

        console.log(`[linkedin/${provider.name}] snapshot took ${snapshotDurationMs}ms`);
        console.log(`[linkedin/${provider.name}] output:\n${output}`);

        expect(output).toContain("Interpretation (via API):");
        await evaluate(output).toMatch(LINKEDIN_SELECTOR_ASSERTION);
      },
      SNAPSHOT_TIMEOUT,
    );
  }
});
