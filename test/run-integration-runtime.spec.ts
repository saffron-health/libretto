import { describe, expect, it, vi } from "vitest";
import type { LoggerApi } from "../src/shared/logger/index.js";
import {
  installHeadedWorkflowVisualization,
} from "../src/cli/workers/run-integration-runtime.js";

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

    const enabled = await installHeadedWorkflowVisualization({
      context,
      headless: false,
      visualize: true,
      logger,
      instrument,
    });

    expect(enabled).toBe(true);
    expect(instrument).toHaveBeenCalledWith(context, {
      visualize: true,
      logger,
    });
  });

  it("skips visualization for headless runs", async () => {
    const logger = createLogger();
    const instrument = vi.fn(async () => {});

    const enabled = await installHeadedWorkflowVisualization({
      context: {} as never,
      headless: true,
      visualize: true,
      logger,
      instrument,
    });

    expect(enabled).toBe(false);
    expect(instrument).not.toHaveBeenCalled();
  });

  it("skips visualization when disabled explicitly", async () => {
    const logger = createLogger();
    const instrument = vi.fn(async () => {});

    const enabled = await installHeadedWorkflowVisualization({
      context: {} as never,
      headless: false,
      visualize: false,
      logger,
      instrument,
    });

    expect(enabled).toBe(false);
    expect(instrument).not.toHaveBeenCalled();
  });
});
