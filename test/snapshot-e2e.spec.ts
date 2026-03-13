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

const OPEN_TIMEOUT = 60_000;
const SNAPSHOT_TIMEOUT = 120_000;
const PAGE_SETTLE_MS = 8_000;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("snapshot e2e – live site analysis", () => {
  test(
    "linkedin feed: identifies post content and poster name selectors",
    async ({ librettoCli, evaluate }) => {
      const session = "snapshot-e2e-linkedin";

      const open = await librettoCli(`open https://www.linkedin.com/feed/ --session ${session}`);
      expect(open.exitCode).toBe(0);

      await sleep(PAGE_SETTLE_MS);

      const snapshot = await librettoCli(
        `snapshot --session ${session} --objective "Identify CSS selectors for: (1) individual post content text and (2) the name of the poster for each post in the LinkedIn feed."`,
      );

      await librettoCli(`close --session ${session}`);

      const output = snapshot.stdout + "\n" + snapshot.stderr;

      await evaluate(output).toMatch(
        "The output identifies CSS selectors for post content text within a LinkedIn feed AND CSS selectors for the poster's name. Both selectors must reference real HTML attributes or elements visible in a LinkedIn feed page.",
      );
    },
    SNAPSHOT_TIMEOUT,
  );

  test(
    "amazon homepage: identifies product category selectors",
    async ({ librettoCli, evaluate }) => {
      const session = "snapshot-e2e-amazon";

      const open = await librettoCli(`open https://www.amazon.com/ --session ${session}`);
      expect(open.exitCode).toBe(0);

      await sleep(PAGE_SETTLE_MS);

      const snapshot = await librettoCli(
        `snapshot --session ${session} --objective "Identify the different product categories visible on the Amazon homepage and provide CSS selectors that can be used to find or click each category."`,
      );

      await librettoCli(`close --session ${session}`);

      const output = snapshot.stdout + "\n" + snapshot.stderr;

      await evaluate(output).toMatch(
        "The output identifies multiple distinct product categories from the Amazon homepage (e.g. Electronics, Books, Fashion, etc.) and provides CSS selectors for navigating to or clicking those categories.",
      );
    },
    SNAPSHOT_TIMEOUT,
  );

  test(
    "g2.com: identifies cloud challenge or anti-bot protection",
    async ({ librettoCli, evaluate }) => {
      const session = "snapshot-e2e-g2";

      const open = await librettoCli(`open https://www.g2.com/ --session ${session}`);
      expect(open.exitCode).toBe(0);

      await sleep(PAGE_SETTLE_MS);

      const snapshot = await librettoCli(
        `snapshot --session ${session} --objective "Determine if this page shows a Cloudflare challenge, CAPTCHA, anti-bot protection, or any blocking page. If so, identify the challenge type and any relevant selectors. If the page loaded normally, describe the main content."`,
      );

      await librettoCli(`close --session ${session}`);

      const output = snapshot.stdout + "\n" + snapshot.stderr;

      await evaluate(output).toMatch(
        "The output either (a) identifies a Cloudflare challenge, CAPTCHA, or anti-bot protection page and describes it, OR (b) describes the actual G2 homepage content if it loaded normally. The answer must clearly communicate whether a challenge/block was encountered.",
      );
    },
    SNAPSHOT_TIMEOUT,
  );

  test(
    "cambridge dictionary: correctly identifies cloudflare challenge",
    async ({ librettoCli, evaluate }) => {
      const session = "snapshot-e2e-cambridge";

      const open = await librettoCli(
        `open https://dictionary.cambridge.org/us/grammar/british-grammar/less-or-fewer --session ${session}`,
      );
      expect(open.exitCode).toBe(0);

      await sleep(PAGE_SETTLE_MS);

      const snapshot = await librettoCli(
        `snapshot --session ${session} --objective "Determine if this page shows a Cloudflare challenge or verification page. If so, identify it as a Cloudflare challenge and describe the challenge elements. If the page loaded normally, describe the grammar content about less vs fewer."`,
      );

      await librettoCli(`close --session ${session}`);

      const output = snapshot.stdout + "\n" + snapshot.stderr;

      await evaluate(output).toMatch(
        "The output correctly identifies either a Cloudflare challenge/verification page OR describes the actual Cambridge Dictionary grammar content about 'less' vs 'fewer'. The answer must clearly communicate which scenario was encountered.",
      );
    },
    SNAPSHOT_TIMEOUT,
  );

  test(
    "nowsecure.nl: correctly identifies cloudflare challenge",
    async ({ librettoCli, evaluate }) => {
      const session = "snapshot-e2e-nowsecure";

      const open = await librettoCli(`open https://nowsecure.nl/ --session ${session}`);
      expect(open.exitCode).toBe(0);

      await sleep(PAGE_SETTLE_MS);

      const snapshot = await librettoCli(
        `snapshot --session ${session} --objective "Determine if this page shows a Cloudflare challenge, verification, or 'checking your browser' page. Identify the type of challenge and any relevant page elements or selectors."`,
      );

      await librettoCli(`close --session ${session}`);

      const output = snapshot.stdout + "\n" + snapshot.stderr;

      await evaluate(output).toMatch(
        "The output identifies a Cloudflare challenge, browser verification, or 'checking your browser' page. The answer must clearly state that a Cloudflare protection mechanism was detected.",
      );
    },
    SNAPSHOT_TIMEOUT,
  );
});
