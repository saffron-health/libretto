export type LibrettoSmsOtpAuth = {
  apiUrl: string;
  token?: string;
  apiKey?: string;
  jobId?: string;
};

export type WaitForSmsOtpOptions = {
  /** Pool number id from /v1/smsNumbers. */
  numberId?: string;
  /** Tenant label (e.g. `uhc`). Prefer one number per portal. */
  label?: string;
  /** Phone number with country code (e.g. +15551234567) from the tenant pool. */
  phoneNumber?: string;
  /** Max time to wait for the inbound SMS OTP. */
  timeoutMs?: number;
  /** Poll interval while waiting. */
  pollIntervalMs?: number;
  /** Claim TTL requested from the API (seconds). */
  ttlSeconds?: number;
  /**
   * Auth for Libretto Cloud. For deployed jobs, pass `params.__libretto`
   * (injected at dispatch). For local runs, omit and use LIBRETTO_API_KEY.
   */
  cloud?: {
    smsOtp?: {
      apiUrl: string;
      token: string;
      jobId: string;
    };
  };
  auth?: LibrettoSmsOtpAuth;
};

type ClaimResponse = {
  claim: {
    claim_id: string;
    status: "open" | "fulfilled" | "consumed" | "expired";
    phone_number: string;
    number_id: string;
    label: string | null;
    expires_at: string;
    code: string | null;
  };
};

type CreateClaimResponse = {
  success: true;
  claim: ClaimResponse["claim"];
  message: string;
};

function resolveAuth(options: WaitForSmsOtpOptions): LibrettoSmsOtpAuth {
  if (options.auth) return options.auth;
  const injected = options.cloud?.smsOtp;
  if (injected?.apiUrl && injected.token) {
    return {
      apiUrl: injected.apiUrl,
      token: injected.token,
      jobId: injected.jobId,
    };
  }
  const apiKey = process.env.LIBRETTO_API_KEY?.trim();
  const apiUrl =
    process.env.LIBRETTO_API_URL?.trim() || "https://api.libretto.sh";
  if (!apiKey) {
    throw new Error(
      "waitForSmsOtp requires auth: pass params.__libretto from a cloud job, set options.auth, or export LIBRETTO_API_KEY for local runs.",
    );
  }
  return { apiUrl, apiKey };
}

async function orpcPost<T>(
  auth: LibrettoSmsOtpAuth,
  path: string,
  input: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (auth.token) {
    headers["x-libretto-sms-otp-token"] = auth.token;
  } else if (auth.apiKey) {
    headers["x-api-key"] = auth.apiKey;
  } else {
    throw new Error(
      "waitForSmsOtp auth is missing token and apiKey. Pass params.__libretto.smsOtp or LIBRETTO_API_KEY.",
    );
  }

  const response = await fetch(new URL(path, auth.apiUrl).toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({ json: input }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { json?: T; error?: { message?: string } }
    | T
    | null;

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error?.message
        ? payload.error.message
        : `Libretto Cloud ${path} failed with HTTP ${response.status}`;
    throw new Error(
      `${message}. Check SMS number pool setup and that only one claim is open on this inbox.`,
    );
  }

  if (payload && typeof payload === "object" && "json" in payload) {
    return payload.json as T;
  }
  return payload as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Open an SMS OTP claim on a tenant inbox number, then poll until the
 * AgentPhone webhook fulfills it (or the wait times out).
 *
 * Configure numbers outside the workflow (CLI/dashboard). Prefer one number
 * per portal. Do not run concurrent waits on the same inbox number.
 */
export async function waitForSmsOtp(
  options: WaitForSmsOtpOptions,
): Promise<{ code: string; phoneNumber: string; claimId: string }> {
  if (!options.numberId && !options.label && !options.phoneNumber) {
    throw new Error(
      "waitForSmsOtp requires numberId, label, or phoneNumber to select an inbox from your SMS number pool.",
    );
  }

  const auth = resolveAuth(options);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;

  const created = await orpcPost<CreateClaimResponse>(
    auth,
    "/v1/smsOtp/claims/create",
    {
      number_id: options.numberId,
      label: options.label,
      phone_number: options.phoneNumber,
      job_id: auth.jobId,
      ttl_seconds: options.ttlSeconds,
    },
  );

  const claimId = created.claim.claim_id;
  const phoneNumber = created.claim.phone_number;

  while (Date.now() < deadline) {
    const polled = await orpcPost<ClaimResponse>(
      auth,
      "/v1/smsOtp/claims/get",
      { claim_id: claimId, consume: true },
    );
    const claim = polled.claim;
    if (claim.code) {
      return { code: claim.code, phoneNumber, claimId };
    }
    if (claim.status === "expired") {
      throw new Error(
        `SMS OTP claim ${claimId} expired before a code arrived. Click send-code again after opening a new claim, and confirm the portal is texting ${phoneNumber}.`,
      );
    }
    if (claim.status === "consumed") {
      throw new Error(
        `SMS OTP claim ${claimId} was already consumed by another poller. Open a new claim and avoid concurrent waits on the same inbox.`,
      );
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for SMS OTP on ${phoneNumber}. Confirm the portal sent the text to this number and the AgentPhone webhook is configured.`,
  );
}
