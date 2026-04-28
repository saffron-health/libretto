import { describe, expect, it } from "vitest";
import { parseCodexResponsesSse } from "../src/cli/core/api-snapshot-analyzer.js";

describe("parseCodexResponsesSse", () => {
  it("ignores SSE terminators and malformed frames after valid output", () => {
    const output = JSON.stringify({
      answer: "Example Domain",
      selectors: [
        {
          label: "Page heading",
          selector: "h1",
          rationale: "The heading contains the page title.",
        },
      ],
      notes: "Ready.",
    });

    expect(
      parseCodexResponsesSse(
        [
          "event: response.output_text.delta",
          `data: ${JSON.stringify({
            type: "response.output_text.delta",
            delta: output.slice(0, 10),
          })}`,
          "",
          "event: response.output_text.delta",
          `data: ${JSON.stringify({
            type: "response.output_text.delta",
            delta: output.slice(10),
          })}`,
          "",
          "event: response.completed",
          'data: {"type":"response.completed","response":{"error":null}}',
          "",
          "data: [DONE]",
          "data: ",
          "data: {not json",
        ].join("\n"),
      ),
    ).toEqual({
      answer: "Example Domain",
      selectors: [
        {
          label: "Page heading",
          selector: "h1",
          rationale: "The heading contains the page title.",
        },
      ],
      notes: "Ready.",
    });
  });
});
