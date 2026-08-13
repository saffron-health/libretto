import {
  getLibrettoRuntimeJobAuth,
  LIBRETTO_JOB_TOKEN_HEADER,
  type LibrettoJobAuth,
} from "./runtime-auth.js";

/** API claim lock bounds (seconds). Keep in sync with Libretto Cloud. */
const MIN_CLAIM_TTL_SECONDS = 30;
const MAX_CLAIM_TTL_SECONDS = 5 * 60;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_API_URL = "https://api.libretto.sh";

export type ClaimSmsOtpOptions = {
  /** Pool phone-number id from /v1/smsNumbers. */
  phoneNumberId?: string;
  /** Label set when the inbox was provisioned (e.g. `uhc`). Prefer one number per portal. */
  phoneNumberLabel?: string;
  /** Full phone number with country code (e.g. +15551234567) from the tenant pool. */
  phoneNumber?: string;
  /**
   * How long to wait for the inbound SMS OTP after the claim is opened.
   * Also sets the inbox claim lock (clamped to 30–300 seconds on the API).
   */
  timeoutMs?: number;
  /** Poll interval while waiting. */
  pollIntervalMs?: number;
  /**
   * Optional override. Prefer omitting this: hosted jobs inject a job token
   * automatically; local runs use `LIBRETTO_API_KEY`.
   */
  apiKey?: string;
  /** Libretto Cloud API base URL. Defaults to LIBRETTO_API_URL or https://api.libretto.sh. */
  apiUrl?: string;
};

export type SmsOtpCode = {
  code: string;
  phoneNumber: string;
  claimId: string;
};

/**
 * Exclusive claim on a tenant SMS inbox. Call `wait()` after clicking
 * send-code to poll for the inbound OTP.
 */
export type SmsOtpClaim = {
  phoneNumber: string;
  claimId: string;
  phoneNumberId: string;
  wait(): Promise<SmsOtpCode>;
};

function claimTtlSecondsFromTimeout(timeoutMs: number): number {
  return Math.min(
    MAX_CLAIM_TTL_SECONDS,
    Math.max(MIN_CLAIM_TTL_SECONDS, Math.ceil(timeoutMs / 1000)),
  );
}

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

function resolveAuth(options: ClaimSmsOtpOptions): LibrettoJobAuth {
  const apiUrl =
    options.apiUrl?.trim() ||
    process.env.LIBRETTO_API_URL?.trim() ||
    DEFAULT_API_URL;

  // Explicit override wins (tests / advanced callers).
  const explicitKey = options.apiKey?.trim();
  if (explicitKey) {
    return { apiUrl, apiKey: explicitKey };
  }

  // Hosted Cloud jobs: minted token injected via params.__libretto (ALS).
  const injected = getLibrettoRuntimeJobAuth();
  if (injected?.token && injected.apiUrl) {
    return injected;
  }

  // Local runs: same env var as deploy / CLI / playwright-debugger.
  const apiKey = process.env.LIBRETTO_API_KEY?.trim();
  if (apiKey) {
    return { apiUrl, apiKey };
  }

  throw new Error(
    "claimSmsOtp needs auth. For local runs set LIBRETTO_API_KEY. Hosted Cloud jobs inject auth automatically — redeploy if this error appears in Cloud.",
  );
}

async function orpcPost<T>(
  auth: LibrettoJobAuth,
  path: string,
  input: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (auth.token) {
    headers[LIBRETTO_JOB_TOKEN_HEADER] = auth.token;
  } else if (auth.apiKey) {
    headers["x-api-key"] = auth.apiKey;
  } else {
    throw new Error(
      "claimSmsOtp auth is missing token and apiKey. Set LIBRETTO_API_KEY locally, or run inside a Libretto Cloud job.",
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

async function pollForCode(options: {
  auth: LibrettoJobAuth;
  claimId: string;
  phoneNumber: string;
  timeoutMs: number;
  pollIntervalMs: number;
}): Promise<SmsOtpCode> {
  const { auth, claimId, phoneNumber, timeoutMs, pollIntervalMs } = options;
  const deadline = Date.now() + timeoutMs;

  try {
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
          `SMS OTP claim ${claimId} expired before a code arrived. Open a new claim with claimSmsOtp, click send-code, then call otp.wait(). Confirm the portal is texting ${phoneNumber}.`,
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
      `Timed out after ${timeoutMs}ms waiting for SMS OTP on ${phoneNumber}. Confirm the portal sent the text to this number and that SMS OTP is set up for your tenant.`,
    );
  } catch (err) {
    // Free the inbox lock when the wait ends without a code (timeout / errors).
    try {
      await orpcPost(auth, "/v1/smsOtp/claims/expire", { claim_id: claimId });
    } catch {
      // Best-effort; surface the original wait error.
    }
    throw err;
  }
}

/**
 * Claim (lock) a tenant SMS inbox number for an inbound one-time code.
 *
 * Await this first so the lock is held before you click send-code. Then call
 * `otp.wait()` for the code:
 *
 * ```ts
 * const otp = await claimSmsOtp({ phoneNumberLabel: "uhc" });
 * await page.click('button:has-text("Send code")');
 * const { code } = await otp.wait();
 * ```
 *
 * Auth is automatic: set `LIBRETTO_API_KEY` locally; hosted Cloud jobs inject
 * a short-lived job token. Do not put the API key in workflow source.
 * Configure numbers outside the workflow (CLI/dashboard). Prefer one number
 * per portal. Do not run concurrent claims on the same inbox number.
 */
export async function claimSmsOtp(
  options: ClaimSmsOtpOptions,
): Promise<SmsOtpClaim> {
  if (
    !options.phoneNumberId &&
    !options.phoneNumberLabel &&
    !options.phoneNumber
  ) {
    throw new Error(
      "claimSmsOtp requires phoneNumberId, phoneNumberLabel, or phoneNumber to select an inbox from your SMS number pool.",
    );
  }

  const auth = resolveAuth(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;

  const created = await orpcPost<CreateClaimResponse>(
    auth,
    "/v1/smsOtp/claims/create",
    {
      number_id: options.phoneNumberId,
      label: options.phoneNumberLabel,
      phone_number: options.phoneNumber,
      ttl_seconds: claimTtlSecondsFromTimeout(timeoutMs),
    },
  );

  const claimId = created.claim.claim_id;
  const phoneNumber = created.claim.phone_number;
  const phoneNumberId = created.claim.number_id;

  let waitPromise: Promise<SmsOtpCode> | undefined;

  return {
    phoneNumber,
    claimId,
    phoneNumberId,
    wait() {
      waitPromise ??= pollForCode({
        auth,
        claimId,
        phoneNumber,
        timeoutMs,
        pollIntervalMs,
      });
      return waitPromise;
    },
  };
}
