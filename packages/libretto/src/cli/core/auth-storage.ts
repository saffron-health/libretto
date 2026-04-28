/**
 * Read/write the libretto CLI auth state at ~/.libretto/auth.json.
 *
 * Stores only the interactive CLI session — the cookie returned by sign-up
 * or login. API keys are never persisted here; users put `LIBRETTO_API_KEY`
 * in their `.env` (matching the existing convention used for
 * BROWSERBASE_API_KEY / KERNEL_API_KEY).
 *
 * Notably, the active org id is NOT cached here. The server is the source
 * of truth (api-key metadata.tenantId is server-overridden, and CLI
 * commands that need the org id resolve it via /organization/list).
 *
 * Lookup order for credentials when making API requests:
 *   1. process.env.LIBRETTO_API_KEY  (explicit override; CI-friendly)
 *   2. authState.session.cookie      (from sign-up or login response)
 *
 * File is mode 0600 — only the current user can read it.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type StoredSession = {
  /**
   * The full Cookie request-header value to replay on subsequent
   * /api/auth/* calls. Built from the Set-Cookie values returned by sign-up /
   * login by stripping attributes (Path, HttpOnly, etc) and joining the
   * `name=value` pairs with "; ".
   */
  cookie: string;
  userId: string;
  email: string;
  /** ISO-8601 expiry of the underlying session row, if known. */
  expiresAt: string | null;
};

export type AuthState = {
  /** The hosted-platform base URL the credentials are valid for. */
  apiUrl: string;
  session: StoredSession | null;
};

const FILE_NAME = "auth.json";

function authDir(): string {
  return join(homedir(), ".libretto");
}

function authPath(): string {
  return join(authDir(), FILE_NAME);
}

export async function readAuthState(): Promise<AuthState | null> {
  try {
    const raw = await fs.readFile(authPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    if (!parsed.apiUrl || typeof parsed.apiUrl !== "string") return null;
    return {
      apiUrl: parsed.apiUrl,
      session: parsed.session ?? null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeAuthState(state: AuthState): Promise<void> {
  await fs.mkdir(authDir(), { recursive: true, mode: 0o700 });
  const payload = JSON.stringify(state, null, 2);
  // Write through a temp file + rename so a partial write can never corrupt
  // the credentials file.
  const target = authPath();
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, payload, { mode: 0o600 });
  await fs.rename(tmp, target);
}

export async function clearAuthState(): Promise<void> {
  try {
    await fs.unlink(authPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Convert the array of Set-Cookie headers returned by Better Auth into a
 * single `Cookie:` request-header value. Drops attributes like Path,
 * HttpOnly, Max-Age — only the `name=value` pair survives.
 */
export function setCookieToCookieHeader(setCookie: readonly string[]): string {
  return setCookie
    .map((entry) => entry.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair && pair.includes("=")))
    .join("; ");
}

export function authStatePath(): string {
  return authPath();
}
