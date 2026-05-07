import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

const SNAPSHOT_TIMEOUT = 180_000;
const PAGE_SETTLE_MS = 15_000;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const LINKEDIN_PROFILE_PATH = resolve(
  REPO_ROOT,
  ".libretto/profiles/linkedin.com.json",
);
const liveSnapshotTest = existsSync(LINKEDIN_PROFILE_PATH) ? test : test.skip;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

describe("snapshot e2e – live site compact output", () => {
  liveSnapshotTest(
    "linkedin feed: prints a compact page snapshot",
    async ({ librettoCli, seedProfile }) => {
      const session = "snapshot-e2e-linkedin-compact";
      await seedProfile("linkedin.com", LINKEDIN_PROFILE_PATH);

      await librettoCli(
        `open https://www.linkedin.com/feed/ --headless --session ${session}`,
      );

      await sleep(PAGE_SETTLE_MS);

      const snapshotStart = Date.now();
      const snapshot = await librettoCli(`snapshot --session ${session}`);
      const snapshotDurationMs = Date.now() - snapshotStart;

      await librettoCli(`close --session ${session}`);

      const output = `${snapshot.stdout}\n${snapshot.stderr}`;

      console.log(`[linkedin/compact] snapshot took ${snapshotDurationMs}ms`);
      console.log(`[linkedin/compact] output:\n${output}`);

      expect(output).toContain("Screenshot at ");
      expect(output).toContain("<page");
      expect(output.toLowerCase()).toContain("linkedin");
    },
    SNAPSHOT_TIMEOUT,
  );
});
