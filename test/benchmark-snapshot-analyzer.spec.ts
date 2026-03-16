import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
// @ts-expect-error Benchmark analyzer is a runtime-only .mjs helper without TS declarations.
import { readPromptInput } from "../benchmarks/shared/claude-snapshot-analyzer.mjs";

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
});
