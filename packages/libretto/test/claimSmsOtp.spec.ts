import { afterEach, describe, expect, it, vi } from "vitest";
import { claimSmsOtp } from "../src/shared/workflow/claimSmsOtp.js";

describe("claimSmsOtp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.LIBRETTO_API_URL;
  });

  it("locks the inbox before polling, then returns the consumed code", async () => {
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

    const otp = await claimSmsOtp({
      phoneNumberLabel: "uhc",
      apiKey: "test-key",
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    });

    expect(otp.phoneNumber).toBe("+15551234567");
    expect(otp.claimId).toBe("claim-1");
    expect(otp.phoneNumberId).toBe("num-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const createCall = fetchMock.mock.calls[0];
    expect(createCall?.[0]).toBe("https://api.example.test/v1/smsOtp/claims/create");
    expect((createCall?.[1] as { headers?: Record<string, string> })?.headers).toMatchObject({
      "x-api-key": "test-key",
    });

    const createBody = JSON.parse(
      String((createCall?.[1] as { body?: string })?.body),
    ) as { json: { ttl_seconds: number; label: string; job_id?: string } };
    expect(createBody.json.ttl_seconds).toBe(30);
    expect(createBody.json.label).toBe("uhc");
    expect(createBody.json.job_id).toBeUndefined();

    const result = await otp.wait();
    expect(result).toEqual({
      code: "482913",
      phoneNumber: "+15551234567",
      claimId: "claim-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires a number selector", async () => {
    await expect(
      claimSmsOtp({ apiKey: "test-key" } as never),
    ).rejects.toThrow(/phoneNumber/);
  });

  it("requires apiKey", async () => {
    await expect(
      claimSmsOtp({ phoneNumberLabel: "uhc", apiKey: "   " }),
    ).rejects.toThrow(/apiKey/);
  });
});
