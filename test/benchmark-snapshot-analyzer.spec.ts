import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
// @ts-expect-error Benchmark analyzer is a runtime-only .mjs helper without TS declarations.
import {
  readPromptInput,
  truncatePromptForBenchmarkAnalyzer,
} from "../benchmarks/shared/claude-snapshot-analyzer.mjs";

describe("benchmark snapshot analyzer input", () => {
  test("prefers argv when provided", async () => {
    await expect(
      readPromptInput({
        argv: ["prompt from", "argv"],
        stdin: Readable.from(["prompt from stdin"]),
      }),
    ).resolves.toBe("prompt from argv");
  });

  test("falls back to stdin when argv is empty", async () => {
    await expect(
      readPromptInput({
        argv: [],
        stdin: Readable.from(["prompt from stdin"]),
      }),
    ).resolves.toBe("prompt from stdin");
  });

  test("truncates oversized html snapshots before sending to the benchmark analyzer model", () => {
    const hugeHtml = "<div>" + "x".repeat(120_000) + "</div>";
    const prompt = [
      "# Objective",
      "Find the search box.",
      "",
      "HTML snapshot:",
      "",
      hugeHtml,
      "",
      "Return only a JSON object. Do not include markdown code fences or extra commentary.",
    ].join("\n");

    const truncated = truncatePromptForBenchmarkAnalyzer(prompt, 10_000);

    expect(truncated).toContain("[truncated HTML snapshot:");
    expect(truncated.length).toBeLessThan(prompt.length);
    expect(truncated).toContain("Return only a JSON object.");
  });
});
