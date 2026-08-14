import { afterEach, describe, expect, it, vi } from "vitest";
import { claimSmsOtp } from "../src/shared/workflow/claimSmsOtp.js";
import {
  LIBRETTO_JOB_TOKEN_HEADER,
  runWithLibrettoRuntimeAuth,
} from "../src/shared/workflow/runtime-auth.js";

describe("claimSmsOtp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.LIBRETTO_API_KEY;
    delete process.env.LIBRETTO_API_URL;
  });

  it("uses LIBRETTO_API_KEY locally and locks before polling", async () => {
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

    const otp = await claimSmsOtp({
      phoneNumberLabel: "uhc",
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    });

    expect(otp.claimId).toBe("claim-1");
    expect((fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> })?.headers).toMatchObject({
      "x-api-key": "test-key",
    });

    const result = await otp.wait();
    expect(result.code).toBe("482913");
  });

  it("uses the hosted job token from runtime auth when present", async () => {
    process.env.LIBRETTO_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        json: {
          success: true,
          claim: {
            claim_id: "claim-2",
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
    });
    vi.stubGlobal("fetch", fetchMock);

    await runWithLibrettoRuntimeAuth(
      {
        job: {
          apiUrl: "https://api.hosted.test",
          token: "job-token",
        },
      },
      async () => {
        await claimSmsOtp({ phoneNumberLabel: "uhc" });
      },
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.hosted.test/v1/smsOtp/claims/create",
    );
    expect((fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> })?.headers).toMatchObject({
      [LIBRETTO_JOB_TOKEN_HEADER]: "job-token",
    });
  });

  it("requires a number selector", async () => {
    process.env.LIBRETTO_API_KEY = "test-key";
    await expect(claimSmsOtp({} as never)).rejects.toThrow(/phoneNumber/);
  });

  it("requires LIBRETTO_API_KEY when no hosted token is present", async () => {
    await expect(claimSmsOtp({ phoneNumberLabel: "uhc" })).rejects.toThrow(
      /LIBRETTO_API_KEY/,
    );
  });
});
