import { describe, expect, it, vi } from "vitest";
import type { LoggerApi } from "../src/shared/logger/index.js";
import { installHeadedWorkflowVisualization } from "../src/cli/workers/run-integration-runtime.js";

function createLogger(): LoggerApi {
  const logger: LoggerApi = {
    log() {},
    info() {},
    warn() {},
    error(event, data) {
      return data instanceof Error ? data : new Error(String(event));
    },
    withScope() {
      return logger;
    },
    withContext() {
      return logger;
    },
    async flush() {},
  };

  return logger;
}

describe("installHeadedWorkflowVisualization", () => {
  it("enables visualization for headed runs", async () => {
    const logger = createLogger();
    const context = {} as never;
    const instrument = vi.fn(async () => {});

    await installHeadedWorkflowVisualization({
      context,
      logger,
      instrument,
    });

    expect(instrument).toHaveBeenCalledWith(context, {
      visualize: true,
      logger,
    });
  });
});
