import { expect, test } from "vitest";
import {
  createWorkflowFailureError,
  deserializeWorkflowError,
  formatErrorWithCauses,
  serializeWorkflowError,
} from "./workflow-error.js";

test("createWorkflowFailureError prioritizes workflow frames and keeps Playwright as cause", () => {
  const original = new Error(
    'page.waitForResponse: Timeout 120000ms exceeded while waiting for event "response"\n' +
      "=========================== logs ===========================\n" +
      'waiting for response "**/api"\n' +
      "============================================================",
  );
  original.name = "TimeoutError";
  original.stack = [
    original.message,
    "    at extractExampleData (/workspace/app/src/shared/example.ts:123:27)",
    "    at workflowHandler (/workspace/app/src/workflows/example.ts:45:18)",
    "    at Page.waitForResponse (/workspace/node_modules/playwright-core/lib/client/page.js:10:5)",
    "    at WorkflowController.run (/workspace/packages/libretto/src/cli/core/workflow-runner/runner.ts:180:9)",
    "    at node:internal/process/task_queues:95:5",
  ].join("\n");

  const failure = createWorkflowFailureError(original, {
    cwd: "/workspace/app",
    integrationPath: "/workspace/app/src/workflows/example.ts",
  });

  expect(failure.name).toBe("TimeoutError");
  expect(failure.message).toBe(
    "page.waitForResponse timed out after 120000ms",
  );
  expect(failure.stack).toContain(
    "at extractExampleData (src/shared/example.ts:123:27)",
  );
  expect(failure.stack).toContain(
    "at workflowHandler (src/workflows/example.ts:45:18)",
  );
  expect(failure.stack).toContain(
    "at WorkflowController.run (",
  );
  expect(failure.stack).toContain("playwright-core");
  expect(failure.stack).not.toContain("node:internal");

  expect(failure.cause).toBeInstanceOf(Error);
  const cause = failure.cause as Error;
  expect(cause.message).toContain(
    'Timeout 120000ms exceeded while waiting for event "response"',
  );
  expect(cause.stack).toContain("extractExampleData");
});

test("serializeWorkflowError round-trips stack and cause without custom props", () => {
  const original = new Error("page.waitForResponse: Timeout 500ms exceeded");
  original.name = "TimeoutError";
  (original as Error & { log?: string; secret?: string }).log = "sensitive-log";
  (original as Error & { secret?: string }).secret = "credential";
  original.stack = [
    original.message,
    "    at waitForMissingResponse (/tmp/workflow.ts:4:14)",
    "    at workflowHandler (/tmp/workflow.ts:8:9)",
  ].join("\n");

  const failure = createWorkflowFailureError(original, { cwd: "/tmp" });
  const serialized = serializeWorkflowError(failure);

  expect(serialized).not.toHaveProperty("log");
  expect(serialized).not.toHaveProperty("secret");
  expect(serialized.stack).toContain("waitForMissingResponse");
  expect(serialized.cause).toMatchObject({
    name: "TimeoutError",
    message: expect.stringContaining("Timeout 500ms exceeded"),
  });

  const restored = deserializeWorkflowError(serialized);
  const formatted = formatErrorWithCauses(restored);
  expect(formatted).toContain("waitForMissingResponse (workflow.ts:4:14)");
  expect(formatted).toContain("Caused by:");
  expect(formatted).toContain("Timeout 500ms exceeded");
  expect(formatted).not.toContain("credential");
  expect(formatted).not.toContain("sensitive-log");
});

test("formatErrorWithCauses prints nested cause stacks", () => {
  const cause = new Error("inner failure");
  cause.name = "TimeoutError";
  cause.stack = "TimeoutError: inner failure\n    at foo (a.ts:1:1)";
  const outer = new Error("outer failure", { cause });
  outer.name = "TimeoutError";
  outer.stack = "TimeoutError: outer failure\n    at bar (b.ts:2:2)";

  expect(formatErrorWithCauses(outer)).toBe(
    [
      "TimeoutError: outer failure",
      "    at bar (b.ts:2:2)",
      "Caused by: TimeoutError: inner failure",
      "    at foo (a.ts:1:1)",
    ].join("\n"),
  );
});
