import { describe, expect, it, vi } from "vitest";
import {
  formatOperationTimeoutError,
  runWithOperationTimeout,
} from "./operation-timeout.js";

describe("formatOperationTimeoutError", () => {
  it("includes operation and session details", () => {
    const message = formatOperationTimeoutError({
      operation: "snapshot",
      session: "demo",
      timeoutMs: 60_000,
      pageId: "page-abc",
    });
    expect(message).toContain("snapshot timed out after 60000ms");
    expect(message).toContain("session: demo");
    expect(message).toContain("page: page-abc");
    expect(message).toContain("libretto close --session demo");
    expect(message).not.toContain("Raise --timeout");
  });

  it("tells exec callers about --timeout", () => {
    const message = formatOperationTimeoutError({
      operation: "exec",
      session: "demo",
      timeoutMs: 100,
    });
    expect(message).toContain("exec timed out after 100ms");
    expect(message).toContain("Raise --timeout");
  });
});

describe("runWithOperationTimeout", () => {
  it("runs without a deadline when timeoutMs is omitted", async () => {
    const started = Date.now();
    const value = await runWithOperationTimeout(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return "ok";
      },
      { operation: "exec", session: "demo" },
    );
    expect(value).toBe("ok");
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("rejects with operation details and cancels via onTimeout", async () => {
    const onTimeout = vi.fn(async () => {});
    let sawAbort = false;

    await expect(
      runWithOperationTimeout(
        async (signal) => {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 500);
            signal.addEventListener("abort", () => {
              sawAbort = true;
              clearTimeout(timer);
              reject(new Error("aborted"));
            });
          });
          return "never";
        },
        {
          operation: "pages",
          session: "timeout-demo",
          timeoutMs: 40,
          onTimeout,
        },
      ),
    ).rejects.toThrow(/pages timed out after 40ms \(session: timeout-demo\)/);

    expect(sawAbort).toBe(true);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid timeoutMs before starting the operation", async () => {
    const operation = vi.fn(async () => "ok");
    await expect(
      runWithOperationTimeout(operation, {
        operation: "exec",
        session: "demo",
        timeoutMs: 0,
      }),
    ).rejects.toThrow(/timeoutMs must be a positive number/);
    expect(operation).not.toHaveBeenCalled();
  });
});
