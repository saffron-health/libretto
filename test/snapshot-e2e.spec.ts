import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

/**
 * End-to-end snapshot tests.
 *
 * Tests cover:
 * - Snapshot resilience against ad interstitials / blocked pages that collapse
 *   the viewport (Cambridge vignette popup test).
 * - Snapshot analysis on real sites with saved profiles (LinkedIn, Amazon).
 *
 * Requirements:
 * - ANTHROPIC_API_KEY or OPENAI_API_KEY must be set for snapshot analysis.
 * - Network access to the target sites.
 * - Playwright Chromium installed.
 * - Saved profiles in .libretto/profiles/ for authenticated tests (LinkedIn, Amazon).
 */

const SNAPSHOT_TIMEOUT = 120_000;
const PAGE_SETTLE_MS = 8_000;

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

/** Env vars forwarded to snapshot CLI calls so the API analyzer can authenticate. */
const snapshotEnv: Record<string, string> = {
  ...(dotEnv.OPENAI_API_KEY ? { OPENAI_API_KEY: dotEnv.OPENAI_API_KEY } : {}),
  ...(dotEnv.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: dotEnv.ANTHROPIC_API_KEY } : {}),
  ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}),
  ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
};

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("snapshot e2e – live site analysis", () => {
  test(
    "cambridge dictionary: snapshot survives ad interstitial / blocked page",
    async ({ librettoCli }) => {
      const session = "snapshot-e2e-cambridge-popup";

      // Open directly to the vignette URL which triggers an ad interstitial
      // that can collapse the viewport to 0px width.
      // NOTE: This test is nondeterministic — the popup/interstitial does not
      // always appear. The test still validates that the snapshot pipeline
      // completes regardless of whether the popup is shown.
      const open = await librettoCli(
        `open https://dictionary.cambridge.org/grammar/british-grammar/less-or-fewer#google_vignette --headed --session ${session}`,
      );
      expect(open.exitCode).toBe(0);

      await sleep(PAGE_SETTLE_MS);

      // Snapshot should not crash with "Cannot take screenshot with 0 width"
      // even if the page is blocked or showing an ad interstitial.
      const snapshotStart = Date.now();
      const snapshot = await librettoCli(
        `snapshot --session ${session} --objective "Describe the current page state and whether it shows real content, an ad interstitial, or an error page." --context "This page may be showing an ad popup or interstitial that collapses the viewport."`,
        snapshotEnv,
      );
      const snapshotDurationMs = Date.now() - snapshotStart;
      const snapshotSuccess = snapshot.exitCode === 0;
      console.log(`[cambridge-popup] snapshot took ${snapshotDurationMs}ms (success=${snapshotSuccess})`);

      await librettoCli(`close --session ${session}`);

      const output = snapshot.stdout + "\n" + snapshot.stderr;

      // The snapshot pipeline must complete — PNG/HTML/condensed HTML saved.
      expect(output).toContain("Snapshot saved:");
      expect(output).toContain("page.png");
      expect(output).toContain("page.html");
      expect(output).toContain("page.condensed.html");
      // Analysis must return an interpretation (doesn't matter what it says).
      expect(output).toContain("Interpretation (via API):");
    },
    SNAPSHOT_TIMEOUT,
  );

  test(
    "linkedin feed: identifies post content and poster name selectors",
    async ({ librettoCli, evaluate }) => {
      const session = "snapshot-e2e-linkedin";

      // Uses saved profile from .libretto/profiles/linkedin.com.json if available
      const open = await librettoCli(`open https://www.linkedin.com/feed/ --session ${session}`);
      expect(open.exitCode).toBe(0);

      await sleep(PAGE_SETTLE_MS);

      const snapshotStart = Date.now();
      const snapshot = await librettoCli(
        `snapshot --session ${session} --objective "Identify CSS selectors for: (1) individual post content text and (2) the name of the poster for each post in the LinkedIn feed."`,
        snapshotEnv,
      );
      const snapshotDurationMs = Date.now() - snapshotStart;
      const snapshotSuccess = snapshot.exitCode === 0;
      console.log(`[linkedin] snapshot took ${snapshotDurationMs}ms (success=${snapshotSuccess})`);

      await librettoCli(`close --session ${session}`);

      const output = snapshot.stdout + "\n" + snapshot.stderr;

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

  test(
    "amazon homepage: identifies product category selectors",
    async ({ librettoCli, evaluate }) => {
      const session = "snapshot-e2e-amazon";

      // Uses saved profile from .libretto/profiles/amazon.com.json if available
      const open = await librettoCli(`open https://www.amazon.com/ --session ${session}`);
      expect(open.exitCode).toBe(0);

      await sleep(PAGE_SETTLE_MS);

      const snapshotStart = Date.now();
      const snapshot = await librettoCli(
        `snapshot --session ${session} --objective "Identify the different product categories visible on the Amazon homepage and provide CSS selectors that can be used to find or click each category."`,
        snapshotEnv,
      );
      const snapshotDurationMs = Date.now() - snapshotStart;
      const snapshotSuccess = snapshot.exitCode === 0;
      console.log(`[amazon] snapshot took ${snapshotDurationMs}ms (success=${snapshotSuccess})`);

      await librettoCli(`close --session ${session}`);

      const output = snapshot.stdout + "\n" + snapshot.stderr;

      await evaluate(output).toMatch(
        "The output identifies multiple distinct product categories from the Amazon homepage (e.g. Electronics, Books, Fashion, etc.) and provides CSS selectors for navigating to or clicking those categories.",
      );
    },
    SNAPSHOT_TIMEOUT,
  );

  // Not included in this PR: Cloudflare challenge detection tests for
  // g2.com, nowsecure.nl, and crunchbase.com. These sites consistently
  // trigger Cloudflare challenges/anti-bot protection, making them useful
  // for testing challenge detection but unreliable for CI. They could be
  // added in a future PR with appropriate retry/skip logic.
});
