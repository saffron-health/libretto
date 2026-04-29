/**
 * HTTP helpers used by the auth CLI commands.
 *
 * - `authFetch` picks the best available credential (env api-key > stored
 *   api-key > stored cookie) and attaches it to the outgoing request.
 * - `orpcCall` wraps the JSON shape used by the api's RPCHandler at /v1/*
 *   (input is `{ json: ... }`, output unwraps `body.json`).
 *
 * The helpers don't know about specific endpoints — callers pass paths.
 */

import { readAuthState, writeAuthState, type AuthState } from "./auth-storage.js";

export const HOSTED_API_URL = "https://api.libretto.sh";

/**
 * Shared "you have no usable credential" message. Pointed at the two
 * recovery paths so users don't have to remember which mechanism does what.
 */
export const NOT_AUTHENTICATED_MESSAGE = [
  "Not authenticated.",
  "  • Cookie expired or never set: run `libretto experimental auth login` to refresh it.",
  "  • Or set LIBRETTO_API_KEY in your .env (issue one with `libretto experimental auth api-key issue --label <label>` after logging in).",
].join("\n");

export type CredentialSource = "env-api-key" | "cookie" | "none";

export type CredentialChoice = {
  source: CredentialSource;
  apiKey?: string;
  cookie?: string;
};

export function pickCredential(state: AuthState | null): CredentialChoice {
  const envKey = process.env.LIBRETTO_API_KEY?.trim();
  if (envKey) return { source: "env-api-key", apiKey: envKey };
  if (state?.session?.cookie) {
    return { source: "cookie", cookie: state.session.cookie };
  }
  return { source: "none" };
}

export function resolveApiUrl(_state: AuthState | null): string {
  return HOSTED_API_URL;
}

type FetchOptions = {
  apiUrl: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  /** Override the credential picked from auth state. */
  credential?: CredentialChoice;
  /** Skip credential injection entirely (used for sign-up / login). */
  unauthenticated?: boolean;
};

export async function authFetch(options: FetchOptions): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Better Auth's CSRF middleware rejects state-changing requests
    // ("/api/auth/*" POSTs like api-key/create, organization/invite-member,
    // sign-in/email, etc.) when there's no Origin header. Browsers send
    // this automatically; node:fetch does not. Sending the apiUrl as the
    // Origin matches Better Auth's trustedOrigins default (which includes
    // baseURL), so the check passes for our own service.
    Origin: options.apiUrl,
  };

  if (!options.unauthenticated) {
    const credential = options.credential ?? pickCredential(await readAuthState());
    if (credential.source === "env-api-key") {
      headers["x-api-key"] = credential.apiKey!;
    } else if (credential.source === "cookie") {
      headers["cookie"] = credential.cookie!;
    } else {
      throw new Error(NOT_AUTHENTICATED_MESSAGE);
    }
  }

  const response = await fetch(`${options.apiUrl}${options.path}`, {
    method: options.method ?? "POST",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  return response;
}

/**
 * Error thrown by `orpcCall` / `betterAuthCall` for non-2xx responses.
 *
 * Carries the HTTP status, the ORPC-serialized error code (e.g. "CONFLICT",
 * "BAD_REQUEST"), and the optional `data` payload that the server attaches
 * (e.g. `{ reason: "slug_taken" }`). Callers can branch on these without
 * relying on message-text matching.
 */
export class ApiCallError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly data: unknown;
  readonly path: string;
  constructor(opts: {
    message: string;
    status: number;
    code: string | null;
    data: unknown;
    path: string;
  }) {
    super(opts.message);
    this.name = "ApiCallError";
    this.status = opts.status;
    this.code = opts.code;
    this.data = opts.data;
    this.path = opts.path;
  }
}

export async function orpcCall<TResult>(opts: {
  apiUrl: string;
  path: string;
  input?: Record<string, unknown>;
  unauthenticated?: boolean;
  credential?: CredentialChoice;
}): Promise<TResult> {
  const response = await authFetch({
    apiUrl: opts.apiUrl,
    method: "POST",
    path: opts.path,
    body: { json: opts.input ?? {} },
    unauthenticated: opts.unauthenticated,
    credential: opts.credential,
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new ApiCallError({
      message: `Unexpected non-JSON response from ${opts.path} (${response.status}): ${text.slice(0, 200)}`,
      status: response.status,
      code: null,
      data: null,
      path: opts.path,
    });
  }

  if (!response.ok) {
    const message = extractErrorMessage(parsed) ?? `${opts.path} failed (${response.status})`;
    throw new ApiCallError({
      message,
      status: response.status,
      code: extractErrorCode(parsed),
      data: extractErrorData(parsed),
      path: opts.path,
    });
  }

  const json = (parsed as { json?: unknown }).json;
  if (json === undefined) {
    return parsed as TResult;
  }
  return json as TResult;
}

/**
 * Better Auth endpoints at /api/auth/* return plain JSON (not ORPC-wrapped).
 * They also set `Set-Cookie` on sign-in. This helper exposes both.
 */
export async function betterAuthCall<TResult>(opts: {
  apiUrl: string;
  path: string;
  method?: "GET" | "POST";
  input?: unknown;
  unauthenticated?: boolean;
  credential?: CredentialChoice;
}): Promise<{ data: TResult; setCookie: string[] }> {
  const response = await authFetch({
    apiUrl: opts.apiUrl,
    method: opts.method ?? "POST",
    path: opts.path,
    body: opts.input,
    unauthenticated: opts.unauthenticated,
    credential: opts.credential,
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new Error(
      `Unexpected non-JSON response from ${opts.path} (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  if (!response.ok) {
    const message = extractErrorMessage(parsed) ?? `${opts.path} failed (${response.status})`;
    throw new ApiCallError({
      message,
      status: response.status,
      code: extractErrorCode(parsed),
      data: extractErrorData(parsed),
      path: opts.path,
    });
  }

  const setCookie = readSetCookies(response);
  return { data: parsed as TResult, setCookie };
}

function readSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (
    record.json &&
    typeof record.json === "object" &&
    typeof (record.json as Record<string, unknown>).message === "string"
  ) {
    return (record.json as Record<string, string>).message;
  }
  if (record.error && typeof record.error === "object") {
    const errMsg = (record.error as Record<string, unknown>).message;
    if (typeof errMsg === "string") return errMsg;
  }
  return null;
}

function extractErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  if (
    record.json &&
    typeof record.json === "object" &&
    typeof (record.json as Record<string, unknown>).code === "string"
  ) {
    return (record.json as Record<string, string>).code;
  }
  if (record.error && typeof record.error === "object") {
    const code = (record.error as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function extractErrorData(body: unknown): unknown {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.data !== undefined) return record.data;
  if (record.json && typeof record.json === "object") {
    const inner = (record.json as Record<string, unknown>).data;
    if (inner !== undefined) return inner;
  }
  if (record.error && typeof record.error === "object") {
    const inner = (record.error as Record<string, unknown>).data;
    if (inner !== undefined) return inner;
  }
  return null;
}

export async function ensureAuthState(apiUrl: string): Promise<AuthState> {
  const existing = await readAuthState();
  if (existing && existing.apiUrl === apiUrl) return existing;
  const next: AuthState = existing
    ? { ...existing, apiUrl }
    : { apiUrl, session: null };
  await writeAuthState(next);
  return next;
}
