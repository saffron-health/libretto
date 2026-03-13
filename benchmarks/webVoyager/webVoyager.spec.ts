import { describe, test } from "vitest";
import { runBrowserBenchmarkCase } from "../shared/cases.js";
import { getWebVoyagerCases } from "./cases.js";

describe("webVoyager benchmark", () => {
  for (const testCase of getWebVoyagerCases()) {
    test.concurrent(
      `${testCase.id}: ${testCase.title}`,
      async () => {
        await runBrowserBenchmarkCase(testCase);
      },
    );
  }
});
