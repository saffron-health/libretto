import { describe, test } from "vitest";
import { runBrowserBenchmarkCase } from "../shared/cases.js";
import { onlineMind2WebCases } from "./cases.js";

describe("onlineMind2Web benchmark", () => {
  for (const testCase of onlineMind2WebCases) {
    test(
      `${testCase.id}: ${testCase.title}`,
      async () => {
        await runBrowserBenchmarkCase(testCase);
      },
    );
  }
});
