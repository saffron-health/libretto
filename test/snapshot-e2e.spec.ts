import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

/**
 * End-to-end snapshot tests.
 *
 * Each test launches a headed browser to a real website, immediately runs
 * `snapshot --objective`, then uses the AI evaluator to verify the snapshot
 * output satisfies the stated success criteria.
 *
 * Requirements:
 * - ANTHROPIC_API_KEY or OPENAI_API_KEY must be set for snapshot analysis.
 * - Network access to the target sites.
 * - Playwright Chromium installed.
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
    "cambridge dictionary: navigate then snapshot grammar content",
    async ({ librettoCli, evaluate }) => {
      const session = "webvoyager-cambridge-dictionary-32";

      // 1. Open browser to the Cambridge Dictionary root
      const open = await librettoCli(
        `open https://dictionary.cambridge.org/ --headless --session ${session}`,
      );
      expect(open.exitCode).toBe(0);

      // 2. Navigate to the specific grammar page and wait for it to settle
      const exec = await librettoCli(
        `exec --session ${session} "await page.goto('https://dictionary.cambridge.org/grammar/british-grammar/less-or-fewer'); await page.waitForTimeout(3000); return await page.url();"`,
      );
      expect(exec.stdout).toContain("less-or-fewer");

      // 3. Snapshot with objective
      const snapshot = await librettoCli(
        `snapshot --session ${session} --objective "Read the full content about differences between fewer and less, including all examples of correct usage" --context "On the Cambridge Dictionary grammar page for less-or-fewer. Need to extract the key differences and example sentences."`,
        snapshotEnv,
      );

      await librettoCli(`close --session ${session}`);

      const output = snapshot.stdout + "\n" + snapshot.stderr;

      await evaluate(output).toMatch(
        "The output describes the differences between 'fewer' and 'less' and includes example sentences of correct usage, OR it identifies a Cloudflare challenge/block page. The answer must contain substantive grammar content or clearly state a challenge was encountered.",
      );
    },
    SNAPSHOT_TIMEOUT,
  );

  // test(
  //   "linkedin feed: identifies post content and poster name selectors",
  //   async ({ librettoCli, evaluate }) => {
  //     const session = "snapshot-e2e-linkedin";
  //
  //     const open = await librettoCli(`open https://www.linkedin.com/feed/ --session ${session}`);
  //     expect(open.exitCode).toBe(0);
  //
  //     await sleep(PAGE_SETTLE_MS);
  //
  //     const snapshot = await librettoCli(
  //       `snapshot --session ${session} --objective "Identify CSS selectors for: (1) individual post content text and (2) the name of the poster for each post in the LinkedIn feed."`,
  //       snapshotEnv,
  //     );
  //
  //     await librettoCli(`close --session ${session}`);
  //
  //     const output = snapshot.stdout + "\n" + snapshot.stderr;
  //
  //     await evaluate(output).toMatch(
  //       "The output identifies CSS selectors for post content text within a LinkedIn feed AND CSS selectors for the poster's name. Both selectors must reference real HTML attributes or elements visible in a LinkedIn feed page.",
  //     );
  //   },
  //   SNAPSHOT_TIMEOUT,
  // );

  // test(
  //   "amazon homepage: identifies product category selectors",
  //   async ({ librettoCli, evaluate }) => {
  //     const session = "snapshot-e2e-amazon";
  //
  //     const open = await librettoCli(`open https://www.amazon.com/ --session ${session}`);
  //     expect(open.exitCode).toBe(0);
  //
  //     await sleep(PAGE_SETTLE_MS);
  //
  //     const snapshot = await librettoCli(
  //       `snapshot --session ${session} --objective "Identify the different product categories visible on the Amazon homepage and provide CSS selectors that can be used to find or click each category."`,
  //       snapshotEnv,
  //     );
  //
  //     await librettoCli(`close --session ${session}`);
  //
  //     const output = snapshot.stdout + "\n" + snapshot.stderr;
  //
  //     await evaluate(output).toMatch(
  //       "The output identifies multiple distinct product categories from the Amazon homepage (e.g. Electronics, Books, Fashion, etc.) and provides CSS selectors for navigating to or clicking those categories.",
  //     );
  //   },
  //   SNAPSHOT_TIMEOUT,
  // );

  // test(
  //   "g2.com: identifies cloud challenge or anti-bot protection",
  //   async ({ librettoCli, evaluate }) => {
  //     const session = "snapshot-e2e-g2";
  //
  //     const open = await librettoCli(`open https://www.g2.com/ --session ${session}`);
  //     expect(open.exitCode).toBe(0);
  //
  //     await sleep(PAGE_SETTLE_MS);
  //
  //     const snapshot = await librettoCli(
  //       `snapshot --session ${session} --objective "Determine if this page shows a Cloudflare challenge, CAPTCHA, anti-bot protection, or any blocking page. If so, identify the challenge type and any relevant selectors. If the page loaded normally, describe the main content."`,
  //       snapshotEnv,
  //     );
  //
  //     await librettoCli(`close --session ${session}`);
  //
  //     const output = snapshot.stdout + "\n" + snapshot.stderr;
  //
  //     await evaluate(output).toMatch(
  //       "The output either (a) identifies a Cloudflare challenge, CAPTCHA, or anti-bot protection page and describes it, OR (b) describes the actual G2 homepage content if it loaded normally. The answer must clearly communicate whether a challenge/block was encountered.",
  //     );
  //   },
  //   SNAPSHOT_TIMEOUT,
  // );

  // test(
  //   "nowsecure.nl: correctly identifies cloudflare challenge",
  //   async ({ librettoCli, evaluate }) => {
  //     const session = "snapshot-e2e-nowsecure";
  //
  //     const open = await librettoCli(`open https://nowsecure.nl/ --session ${session}`);
  //     expect(open.exitCode).toBe(0);
  //
  //     await sleep(PAGE_SETTLE_MS);
  //
  //     const snapshot = await librettoCli(
  //       `snapshot --session ${session} --objective "Determine if this page shows a Cloudflare challenge, verification, or 'checking your browser' page. Identify the type of challenge and any relevant page elements or selectors."`,
  //       snapshotEnv,
  //     );
  //
  //     await librettoCli(`close --session ${session}`);
  //
  //     const output = snapshot.stdout + "\n" + snapshot.stderr;
  //
  //     await evaluate(output).toMatch(
  //       "The output identifies a Cloudflare challenge, browser verification, or 'checking your browser' page. The answer must clearly state that a Cloudflare protection mechanism was detected.",
  //     );
  //   },
  //   SNAPSHOT_TIMEOUT,
  // );

  // test(
  //   "crunchbase: identifies cloud challenge or anti-bot protection",
  //   async ({ librettoCli, evaluate }) => {
  //     const session = "snapshot-e2e-crunchbase";
  //
  //     const open = await librettoCli(`open https://www.crunchbase.com/ --session ${session}`);
  //     expect(open.exitCode).toBe(0);
  //
  //     await sleep(PAGE_SETTLE_MS);
  //
  //     const snapshot = await librettoCli(
  //       `snapshot --session ${session} --objective "Determine if this page shows a Cloudflare challenge, CAPTCHA, anti-bot protection, or any blocking page. If so, identify the challenge type and any relevant selectors. If the page loaded normally, describe the main content."`,
  //       snapshotEnv,
  //     );
  //
  //     await librettoCli(`close --session ${session}`);
  //
  //     const output = snapshot.stdout + "\n" + snapshot.stderr;
  //
  //     await evaluate(output).toMatch(
  //       "The output either (a) identifies a Cloudflare challenge, CAPTCHA, or anti-bot protection page and describes it, OR (b) describes the actual Crunchbase homepage content if it loaded normally. The answer must clearly communicate whether a challenge/block was encountered.",
  //     );
  //   },
  //   SNAPSHOT_TIMEOUT,
  // );
});
