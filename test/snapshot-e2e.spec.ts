import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
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
 * - An AI preset must be configured (codex, claude, or gemini) for snapshot analysis.
 * - Network access to the target sites.
 * - Playwright Chromium installed.
 * - Saved profile in .libretto/profiles/linkedin.com.json for authenticated LinkedIn test.
 */

const SNAPSHOT_TIMEOUT = 180_000;
const PAGE_SETTLE_MS = 15_000;

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

/** Env vars forwarded to snapshot CLI calls so the analyzer can authenticate. */
const snapshotEnv: Record<string, string> = {
  ...(dotEnv.OPENAI_API_KEY ? { OPENAI_API_KEY: dotEnv.OPENAI_API_KEY } : {}),
  ...(dotEnv.ANTHROPIC_API_KEY
    ? { ANTHROPIC_API_KEY: dotEnv.ANTHROPIC_API_KEY }
    : {}),
  ...(process.env.OPENAI_API_KEY
    ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY }
    : {}),
  ...(process.env.ANTHROPIC_API_KEY
    ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
    : {}),
};

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("snapshot e2e – live site analysis", () => {
  test(
    "linkedin feed: identifies post content and poster name selectors",
    async ({ librettoCli, evaluate, seedProfile }) => {
      const session = "snapshot-e2e-linkedin";

      // Copy saved LinkedIn profile into test workspace so the browser loads authenticated state
      const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
      const srcProfile = resolve(repoRoot, ".libretto/profiles/linkedin.com.json");
      if (existsSync(srcProfile)) {
        await seedProfile("linkedin.com", srcProfile);
      }

      // Configure AI preset for snapshot analysis
      await librettoCli(`ai configure codex`, snapshotEnv);

      // Uses saved profile from .libretto/profiles/linkedin.com.json if available
      await librettoCli(
        `open https://www.linkedin.com/feed/ --headless --session ${session}`,
      );

      await sleep(PAGE_SETTLE_MS);

      const snapshotStart = Date.now();
      const snapshot = await librettoCli(
        `snapshot --session ${session} --objective "Identify CSS selectors for: (1) individual post content text and (2) the name of the poster for each post in the LinkedIn feed."`,
        snapshotEnv,
      );
      const snapshotDurationMs = Date.now() - snapshotStart;

      await librettoCli(`close --session ${session}`);

      const output = snapshot.stdout + "\n" + snapshot.stderr;

      console.log(`[linkedin] snapshot took ${snapshotDurationMs}ms`);
      console.log(`[linkedin] selectors output:\n${output}`);

      await evaluate(output).toMatch(
        "The output identifies CSS selectors for post content text AND poster names, AND explains the nesting structure for how to chain them. " +
          "Specifically: (1) post content should use [data-testid='expandable-text-box'] or similar data-testid attribute, " +
          "(2) poster names should target anchor elements with href containing '/in/' within feed list items, " +
          "(3) the output must explain nesting — e.g. that the feed container is [data-testid='mainFeed'], individual posts are [role='listitem'] within it, " +
          "and the content/name selectors should be scoped within each post item. " +
          "All selectors must reference real HTML attributes visible in a LinkedIn feed page.",
      );
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
