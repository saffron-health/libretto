import { expect, test } from "vitest";
import { errorToMessage, workflowFailureMessage } from "./workflow-error.js";

test("errorToMessage includes stack frames from the thrown error", () => {
  const error = new Error(
    'page.waitForResponse: Timeout 500ms exceeded while waiting for event "response"',
  );
  error.name = "TimeoutError";
  error.stack = [
    error.message,
    "    at waitForMissingApi (workflow.ts:3:14)",
    "    at extractExampleData (workflow.ts:6:9)",
  ].join("\n");

  const message = errorToMessage(error);
  expect(message).toContain("waitForMissingApi (workflow.ts:3:14)");
  expect(message).toContain("extractExampleData (workflow.ts:6:9)");
  expect(message).toContain("Timeout 500ms exceeded");
});

test("errorToMessage appends cause stacks", () => {
  const cause = new Error("inner failure");
  cause.name = "TimeoutError";
  cause.stack = "TimeoutError: inner failure\n    at foo (a.ts:1:1)";
  const outer = new Error("outer failure", { cause });
  outer.name = "Error";
  outer.stack = "Error: outer failure\n    at bar (b.ts:2:2)";

  expect(errorToMessage(outer)).toBe(
    [
      "Error: outer failure",
      "    at bar (b.ts:2:2)",
      "Caused by: TimeoutError: inner failure",
      "    at foo (a.ts:1:1)",
    ].join("\n"),
  );
});

test("workflowFailureMessage appends stay-open guidance", () => {
  const error = new Error("boom");
  error.stack = "Error: boom\n    at handler (workflow.ts:1:1)";
  expect(workflowFailureMessage(error, { includeStayOpenGuidance: true })).toContain(
    "Browser is still open.",
  );
});
