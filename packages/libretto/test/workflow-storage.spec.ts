import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoggerApi } from "../src/shared/logger/index.js";
import { createWorkflowStorageContext } from "../src/shared/workflow/storage.js";

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

describe("createWorkflowStorageContext", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads JSON to GCP temporary storage", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const storage = createWorkflowStorageContext(createLogger());
    const result = await storage.uploadJson({
      storageAccess: {
        provider: "gcp",
        bucket: "test-bucket",
        prefix: "runs/abc",
        accessToken: "secret-token",
      },
      fileName: "result.json",
      payload: { ok: true },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls.at(0) as unknown[] | undefined;
    expect(firstCall).toBeDefined();
    const url = firstCall![0] as RequestInfo | URL;
    const request = firstCall![1] as RequestInit | undefined;
    expect(String(url)).toBe(
      "https://storage.googleapis.com/upload/storage/v1/b/test-bucket/o?uploadType=media&name=runs%2Fabc%2Fresult.json&ifGenerationMatch=0",
    );
    expect(request).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer secret-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ok: true }),
    });
    expect(result).toEqual({
      provider: "gcp",
      bucket: "test-bucket",
      objectName: "runs/abc/result.json",
      uri: "gs://test-bucket/runs/abc/result.json",
    });
  });

  it("throws when the upload API returns an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => "forbidden",
      })),
    );

    const storage = createWorkflowStorageContext(createLogger());

    await expect(
      storage.uploadJson({
        storageAccess: {
          provider: "gcp",
          bucket: "test-bucket",
          prefix: "runs/abc",
          accessToken: "secret-token",
        },
        fileName: "result.json",
        payload: { ok: true },
      }),
    ).rejects.toThrow(
      "Failed to upload runs/abc/result.json to test-bucket: 403 forbidden",
    );
  });
});
