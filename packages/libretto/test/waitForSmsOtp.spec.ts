import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForSmsOtp } from "../src/shared/workflow/waitForSmsOtp.js";

describe("waitForSmsOtp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.LIBRETTO_API_KEY;
    delete process.env.LIBRETTO_API_URL;
  });

  it("creates a claim and returns the consumed code", async () => {
    process.env.LIBRETTO_API_KEY = "test-key";
    process.env.LIBRETTO_API_URL = "https://api.example.test";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          json: {
            success: true,
            claim: {
              claim_id: "claim-1",
              status: "open",
              phone_number: "+15551234567",
              number_id: "num-1",
              label: "uhc",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              code: null,
            },
            message: "ok",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          json: {
            claim: {
              claim_id: "claim-1",
              status: "consumed",
              phone_number: "+15551234567",
              number_id: "num-1",
              label: "uhc",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              code: "482913",
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await waitForSmsOtp({
      label: "uhc",
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    });

    expect(result).toEqual({
      code: "482913",
      phoneNumber: "+15551234567",
      claimId: "claim-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const createBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as { body?: string })?.body),
    ) as { json: { ttl_seconds: number } };
    expect(createBody.json.ttl_seconds).toBe(30);
  });

  it("requires a number selector", async () => {
    await expect(waitForSmsOtp({} as never)).rejects.toThrow(/numberId/);
  });
});
