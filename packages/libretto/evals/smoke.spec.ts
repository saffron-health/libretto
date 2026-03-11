import { describe } from "vitest";
import { expect, test } from "./fixtures.js";

describe("eval harness smoke", () => {
  test(
    "runs a single-turn eval with libretto skill context",
    async ({ harness }) => {
      const response = await harness.send(
        [
          "In exactly 3 bullet points:",
          "1) Explain what libretto is for.",
          "2) Name one command from the libretto skill that helps inspect what is on a page.",
          "3) End the final bullet with the exact token LIBRETTO_EVAL_SMOKE_OK.",
        ].join("\n"),
      );

      expect(response.messages.length).toBeGreaterThan(0);
      expect(response.transcript).toContain("LIBRETTO_EVAL_SMOKE_OK");

      await response.evaluate(
        "The response explains that libretto is for browser automation, identifies snapshot as a command to inspect page contents, and includes LIBRETTO_EVAL_SMOKE_OK.",
      );
    },
    180_000,
  );
});
