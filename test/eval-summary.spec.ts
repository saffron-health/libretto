import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { assertPerfectScore } from "../evals/scoring.js";

const tempRoots: string[] = [];

afterEach(async () => {
  delete process.env.LIBRETTO_EVAL_STRICT;
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("eval summary scripts", () => {
  test("summary reports aggregate score and failed eval details", async () => {
    // @ts-expect-error -- helper is authored as plain .mjs
    const { buildSummary, buildMarkdown, loadScoreRecords } = await import("../scripts/summarize-evals.mjs");
    const tempRoot = await mkdtemp(join(tmpdir(), "libretto-eval-summary-"));
    tempRoots.push(tempRoot);

    await writeFile(
      join(tempRoot, "passing.json"),
      JSON.stringify({
        name: "passing eval",
        passed: 10,
        total: 10,
        percent: 100,
        failures: [],
      }),
      "utf8",
    );
    await writeFile(
      join(tempRoot, "failing.json"),
      JSON.stringify({
        name: "noisy eval",
        passed: 3,
        total: 4,
        percent: 75,
        failures: [
          {
            criterion: "The rerun produced useful output.",
            reason: "Only a success banner was shown.",
          },
        ],
      }),
      "utf8",
    );

    const records = loadScoreRecords(tempRoot);
    const summary = buildSummary(records);
    const markdown = buildMarkdown(summary, join(tempRoot, "eval-summary.json"));

    expect(summary.percent).toBe(92.86);
    expect(summary.failingRecordCount).toBe(1);
    expect(markdown).toContain("Overall score: `92.86%`");
    expect(markdown).toContain("### `noisy eval`");
    expect(markdown).toContain("The rerun produced useful output.: Only a success banner was shown.");
  });

  test("assertPerfectScore throws by default for local strict runs", () => {
    delete process.env.LIBRETTO_EVAL_STRICT;

    expect(() =>
      assertPerfectScore("strict eval", {
        passed: 3,
        total: 4,
        percent: 75,
        criteria: [
          {
            criterion: "The assistant did the thing.",
            pass: false,
            reason: "Evidence was incomplete.",
          },
        ],
      }),
    ).toThrowError("Expected 100% score, got 75%.");
  });

  test("assertPerfectScore records but does not throw when strict mode is disabled", () => {
    process.env.LIBRETTO_EVAL_STRICT = "false";

    expect(() =>
      assertPerfectScore("non-strict eval", {
        passed: 3,
        total: 4,
        percent: 75,
        criteria: [
          {
            criterion: "The assistant did the thing.",
            pass: false,
            reason: "Evidence was incomplete.",
          },
        ],
      }),
    ).not.toThrow();

    delete process.env.LIBRETTO_EVAL_STRICT;
  });
});
