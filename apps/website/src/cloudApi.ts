type OrpcResponse<T> = {
  json?: T;
  error?: {
    message?: string;
    code?: string;
  };
  message?: string;
};

export type CloudSession = {
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    name?: string;
    image?: string | null;
  };
  session: {
    id: string;
    expiresAt: string;
  };
};

export type AuthStatus = {
  userId: string;
  email: string;
  emailVerified: boolean;
  hasTenant: boolean;
  tenantId: string | null;
};

export const cloudApiUrl =
  import.meta.env.VITE_LIBRETTO_CLOUD_API_URL?.trim() ||
  (window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:8080"
    : "https://api.libretto.sh");

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Unexpected response from Libretto Cloud (${response.status})`);
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as OrpcResponse<unknown>;
  const json = record.json;
  if (json && typeof json === "object") {
    const jsonRecord = json as { message?: unknown };
    if (typeof jsonRecord.message === "string") return jsonRecord.message;
  }
  return record.error?.message || record.message || fallback;
}

export async function orpcCall<T>(
  path: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(`${cloudApiUrl}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  const body = (await parseJson(response)) as OrpcResponse<T>;
  if (!response.ok) {
    throw new Error(errorMessage(body, `${path} failed (${response.status})`));
  }
  return (body.json ?? body) as T;
}

export async function authGet<T>(path: string): Promise<T> {
  const response = await fetch(`${cloudApiUrl}${path}`, {
    method: "GET",
    credentials: "include",
  });
  const body = await parseJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(body, `${path} failed (${response.status})`));
  }
  return body as T;
}

export async function authPost<T>(
  path: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${cloudApiUrl}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await parseJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(body, `${path} failed (${response.status})`));
  }
  return body as T;
}

export async function getCloudSession(): Promise<CloudSession | null> {
  return authGet<CloudSession | null>("/api/auth/get-session");
}

export async function getAuthStatus(): Promise<AuthStatus> {
  return orpcCall<AuthStatus>("/v1/auth/status");
}
