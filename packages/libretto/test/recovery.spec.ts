import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { attemptWithRecovery } from "../src/index.js";

describe("attemptWithRecovery", () => {
  it("explains how to enable recovery when no model is configured", async () => {
    const originalError = new Error("button remained covered");
    const action = async (): Promise<void> => {
      throw originalError;
    };

    await expect(
      attemptWithRecovery({} as Page, action),
    ).rejects.toMatchObject({
      message:
        "Recovery was not attempted because no model is configured. Pass a LanguageModel as the fourth argument to attemptWithRecovery, or call the action directly without recovery.",
      cause: originalError,
    });
  });
});
