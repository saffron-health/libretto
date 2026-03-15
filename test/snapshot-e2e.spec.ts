import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

/**
 * End-to-end snapshot tests.
 *
 * Tests cover:
 * - Snapshot analysis on real sites with saved profiles (LinkedIn).
 *
 * Requirements:
 * - API credentials must be available for one supported snapshot provider.
 * - Network access to the target sites.
 * - Playwright Chromium installed.
 * - Saved profile in .libretto/profiles/linkedin.com.json for authenticated LinkedIn test.
 */

const SNAPSHOT_TIMEOUT = 180_000;
const PAGE_SETTLE_MS = 45_000;
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const linkedInProfilePath = resolve(repoRoot, ".libretto/profiles/linkedin.com.json");

function resolveSharedRepoEnvPath(repoRoot: string): string | null {
  const gitPath = resolve(repoRoot, ".git");
  if (!existsSync(gitPath)) return null;

  try {
    const gitPointer = readFileSync(gitPath, "utf-8").trim();
    const match = gitPointer.match(/^gitdir:\s*(.+)$/i);
    if (!match?.[1]) return null;
    const worktreeGitDir = resolve(repoRoot, match[1].trim());
    const commonGitDir = resolve(worktreeGitDir, "..", "..");
    return resolve(dirname(commonGitDir), ".env");
  } catch {
    return null;
  }
}

/** Load API keys from repo root .env so the CLI subprocess can use them. */
function loadEnvFile(): Record<string, string> {
  const envPathCandidates = [
    resolve(repoRoot, ".env"),
    resolveSharedRepoEnvPath(repoRoot),
  ].filter((value): value is string => Boolean(value));
  const envPath = envPathCandidates.find((candidate) => existsSync(candidate));
  const env: Record<string, string> = {};
  if (!envPath) return env;
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

/** Env vars forwarded to snapshot CLI calls so the analyzer can authenticate. */
const snapshotEnv: Record<string, string> = {
  ...(dotEnv.OPENAI_API_KEY ? { OPENAI_API_KEY: dotEnv.OPENAI_API_KEY } : {}),
  ...(dotEnv.ANTHROPIC_API_KEY
    ? { ANTHROPIC_API_KEY: dotEnv.ANTHROPIC_API_KEY }
    : {}),
  ...(dotEnv.GEMINI_API_KEY ? { GEMINI_API_KEY: dotEnv.GEMINI_API_KEY } : {}),
  ...(dotEnv.GOOGLE_GENERATIVE_AI_API_KEY
    ? { GOOGLE_GENERATIVE_AI_API_KEY: dotEnv.GOOGLE_GENERATIVE_AI_API_KEY }
    : {}),
  ...(dotEnv.GOOGLE_CLOUD_PROJECT
    ? { GOOGLE_CLOUD_PROJECT: dotEnv.GOOGLE_CLOUD_PROJECT }
    : {}),
  ...(dotEnv.GCLOUD_PROJECT
    ? { GCLOUD_PROJECT: dotEnv.GCLOUD_PROJECT }
    : {}),
  ...(dotEnv.GOOGLE_CLOUD_LOCATION
    ? { GOOGLE_CLOUD_LOCATION: dotEnv.GOOGLE_CLOUD_LOCATION }
    : {}),
  ...(dotEnv.GOOGLE_APPLICATION_CREDENTIALS
    ? {
        GOOGLE_APPLICATION_CREDENTIALS:
          dotEnv.GOOGLE_APPLICATION_CREDENTIALS,
      }
    : {}),
  ...(process.env.OPENAI_API_KEY
    ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY }
    : {}),
  ...(process.env.ANTHROPIC_API_KEY
    ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
    : {}),
  ...(process.env.GEMINI_API_KEY
    ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY }
    : {}),
  ...(process.env.GOOGLE_GENERATIVE_AI_API_KEY
    ? {
        GOOGLE_GENERATIVE_AI_API_KEY:
          process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      }
    : {}),
  ...(process.env.GOOGLE_CLOUD_PROJECT
    ? { GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT }
    : {}),
  ...(process.env.GCLOUD_PROJECT
    ? { GCLOUD_PROJECT: process.env.GCLOUD_PROJECT }
    : {}),
  ...(process.env.GOOGLE_CLOUD_LOCATION
    ? { GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION }
    : {}),
  ...(process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? {
        GOOGLE_APPLICATION_CREDENTIALS:
          process.env.GOOGLE_APPLICATION_CREDENTIALS,
      }
    : {}),
};
const hasSnapshotApiCredentials = Boolean(
  snapshotEnv.OPENAI_API_KEY
  || snapshotEnv.ANTHROPIC_API_KEY
  || snapshotEnv.GEMINI_API_KEY
  || snapshotEnv.GOOGLE_GENERATIVE_AI_API_KEY
  || snapshotEnv.GOOGLE_CLOUD_PROJECT
  || snapshotEnv.GCLOUD_PROJECT,
);
const liveSnapshotTest =
  hasSnapshotApiCredentials && existsSync(linkedInProfilePath) ? test : test.skip;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("snapshot e2e – live site analysis", () => {
  liveSnapshotTest(
    "linkedin feed: identifies post content and poster name selectors",
    async ({ librettoCli, seedProfile }) => {
      const session = "snapshot-e2e-linkedin";

      // Copy saved LinkedIn profile into test workspace so the browser loads authenticated state
      await seedProfile("linkedin.com", linkedInProfilePath);

      // Uses saved profile from .libretto/profiles/linkedin.com.json if available
      await librettoCli(
        `open https://www.linkedin.com/feed/ --headless --session ${session}`,
      );

      await sleep(PAGE_SETTLE_MS);
      const snapshotStart = Date.now();
      const snapshot = await librettoCli(
        `snapshot --session ${session} --objective "Identify CSS selectors for the LinkedIn feed so that: (1) individual post content text uses [data-testid='expandable-text-box'] within each post when present, (2) poster names are selected via anchors with href containing '/in/' inside each post, and (3) the nesting is described from [data-testid='mainFeed'] to [role='listitem'] to the scoped poster/content selectors."`,
        snapshotEnv,
      );
      const snapshotDurationMs = Date.now() - snapshotStart;

      await librettoCli(`close --session ${session}`);

      const output = snapshot.stdout + "\n" + snapshot.stderr;

      console.log(`[linkedin] snapshot took ${snapshotDurationMs}ms`);
      console.log(`[linkedin] selectors output:\n${output}`);

      expect(output).toContain("Interpretation (via API):");
      expect(output).toContain("[data-testid='mainFeed']");
      expect(output).toContain("[role='listitem']");
      expect(output).toContain("[data-testid='expandable-text-box']");
      expect(output).toContain("a[href*='/in/']");
    },
    SNAPSHOT_TIMEOUT,
  );

  // Not included in this PR:
  // - Cambridge Dictionary (dictionary.cambridge.org) — ad interstitial/popup
  //   resilience test. Nondeterministic; popup doesn't always appear.
  // - Amazon (amazon.com) — search result extraction test. Amazon's anti-bot
  //   detection replaces the DOM with a CAPTCHA script, making the HTML
  //   snapshot unreliable even though the screenshot renders correctly.
  // - Cloudflare challenge sites: g2.com, nowsecure.nl, crunchbase.com.
  //   Useful for testing challenge detection but unreliable for CI.
  // These could be added in a future PR with appropriate handling.
});
