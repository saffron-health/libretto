/**
 * Hosted-platform auth commands.
 *
 *   libretto cloud auth signup
 *   libretto cloud auth login
 *   libretto cloud auth logout
 *   libretto cloud auth invite <email> [--role member|owner]
 *   libretto cloud auth api-key issue [--label <label>]
 *   libretto cloud auth api-key list
 *   libretto cloud auth api-key revoke <id>
 *   libretto cloud auth whoami
 *
 * Credentials live at ~/.libretto/auth.json (mode 0600). The CLI sends either
 * the stored API key or the stored session cookie depending on what's
 * available, with LIBRETTO_API_KEY winning when set.
 */

import { spawn } from "node:child_process";
import { z } from "zod";
import { SimpleCLI } from "affordance";
import {
  betterAuthCall,
  NOT_AUTHENTICATED_MESSAGE,
  orpcCall,
  pickCredential,
  resolveApiUrl,
  resolveHostedApiUrl,
} from "../core/auth-fetch.js";
import {
  authStatePath,
  clearAuthState,
  readAuthState,
  writeAuthState,
  type AuthState,
} from "../core/auth-storage.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type Session = {
  user: { id: string; email: string; emailVerified: boolean; name?: string };
  session: { id: string; expiresAt: string };
};

type ApiKeyCreateResponse = {
  id: string;
  name: string | null;
  prefix?: string | null;
  /** The raw key, returned exactly once. */
  key: string;
};

type ApiKeyListItem = {
  id: string;
  name: string | null;
  prefix?: string | null;
  start?: string | null;
  enabled: boolean | null;
  createdAt: string;
  lastRequest?: string | null;
};

type CliLoginCreateResponse = {
  requestId: string;
  secret: string;
  expiresAt: string;
};

type CliLoginPollResponse =
  | { status: "pending" }
  | { status: "expired" }
  | {
      status: "approved";
      cookieHeader: string;
      userId: string;
      email: string;
      emailVerified: boolean;
      sessionExpiresAt: string | null;
    };

function resolveHostedWebsiteUrl(): string {
  return process.env.LIBRETTO_WEBSITE_URL?.trim() || "https://libretto.sh";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openBrowser(url: string): boolean {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "win32"
      ? ["/c", "start", "", url]
      : [url];

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function getCurrentSession(
  apiUrl: string,
  /**
   * Optional credential override. Pass this when the caller has just
   * performed a sign-in / sign-up and the new cookie hasn't been written
   * to ~/.libretto/auth.json yet — without this, betterAuthCall would
   * fall back to the stale cookie from the file (or none at all).
   */
  cookie?: string,
): Promise<Session | null> {
  try {
    const { data } = await betterAuthCall<Session | null>({
      apiUrl,
      path: "/api/auth/get-session",
      method: "GET",
      credential: cookie ? { source: "cookie", cookie } : undefined,
    });
    return data && typeof data === "object" && "user" in data ? data : null;
  } catch {
    return null;
  }
}

async function runBrowserAuthFlow(options: {
  mode: "login" | "signup";
  apiUrl: string;
  websiteUrl: string;
}): Promise<void> {
  const login = await orpcCall<CliLoginCreateResponse>({
    apiUrl: options.apiUrl,
    path: "/v1/auth/cliLoginCreate",
    unauthenticated: true,
  });

  const loginUrl = new URL("/signin", options.websiteUrl);
  loginUrl.searchParams.set("cliLoginId", login.requestId);
  loginUrl.searchParams.set("cliLoginSecret", login.secret);
  if (options.mode === "signup") {
    loginUrl.searchParams.set("mode", "signup");
  }

  console.log(
    options.mode === "signup"
      ? "Sign up for Libretto Cloud in your browser:"
      : "Sign in to Libretto Cloud in your browser:",
  );
  console.log(`  ${loginUrl.toString()}`);
  console.log();
  if (openBrowser(loginUrl.toString())) {
    console.log("Opened the page in your default browser.");
    console.log("If it didn't open, copy the link above into your browser.");
    console.log();
  } else {
    console.log("Copy the link above into your browser.");
    console.log();
  }
  console.log(
    options.mode === "signup"
      ? "Waiting for browser sign-up"
      : "Waiting for browser sign-in",
  );

  const expiresAt = new Date(login.expiresAt).getTime();
  let verificationHintShown = false;
  while (Date.now() < expiresAt) {
    const result = await orpcCall<CliLoginPollResponse>({
      apiUrl: options.apiUrl,
      path: "/v1/auth/cliLoginPoll",
      input: {
        requestId: login.requestId,
        secret: login.secret,
      },
      unauthenticated: true,
    });

    if (result.status === "expired") {
      throw new Error(
        `Auth request expired. Run \`libretto cloud auth ${options.mode}\` again.`,
      );
    }

    if (result.status === "approved") {
      const session = await getCurrentSession(options.apiUrl, result.cookieHeader);
      if (!session?.user?.id) {
        throw new Error(
          "Browser auth succeeded, but the returned session could not be verified.",
        );
      }

      const next: AuthState = {
        apiUrl: options.apiUrl,
        session: {
          cookie: result.cookieHeader,
          userId: result.userId,
          email: result.email,
          expiresAt: session.session.expiresAt ?? result.sessionExpiresAt,
        },
      };
      await writeAuthState(next);

      console.log();
      console.log(`Logged in as ${result.email}.`);
      if (!result.emailVerified) {
        console.log(
          "Heads up: your email isn't verified yet. Click the verification link in your inbox to finish setup.",
        );
      }
      return;
    }

    if (options.mode === "signup" && !verificationHintShown) {
      console.log();
      console.log("After signing up with email/password, verify your email to finish CLI auth.");
      verificationHintShown = true;
    }
    process.stdout.write(".");
    await sleep(2000);
  }

  console.log();
  throw new Error(
    `Auth request expired. Run \`libretto cloud auth ${options.mode}\` again.`,
  );
}

/**
 * Look up the user's organization id via /organization/list. Used by the
 * invite command to populate the `organizationId` field in the request
 * body — Better Auth's invite-member endpoint requires it (or an active
 * org on the session, which API-key sessions don't have).
 *
 * The server still permission-checks membership, so this is just a UX
 * helper, not a security control.
 */
async function resolveActiveOrgId(
  apiUrl: string,
  credential: ReturnType<typeof pickCredential>,
): Promise<string> {
  const { data: orgs } = await betterAuthCall<Array<{ id: string }>>({
    apiUrl,
    path: "/api/auth/organization/list",
    method: "GET",
    credential,
  });
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new Error(
      "No organization on this account — sign up or accept an invite first.",
    );
  }
  return orgs[0]!.id;
}

async function issueApiKey(
  apiUrl: string,
  name: string,
  credential: ReturnType<typeof pickCredential>,
): Promise<ApiKeyCreateResponse> {
  // We do NOT pass metadata.tenantId — the api-key/create hook in
  // api/src/auth.ts sets it server-side from auth.users.tenantId. Anything
  // we'd send would be overridden anyway, so don't send it.
  const { data } = await betterAuthCall<ApiKeyCreateResponse>({
    apiUrl,
    path: "/api/auth/api-key/create",
    input: { name },
    credential,
  });
  if (!data?.key) {
    throw new Error("API-key creation returned no raw key.");
  }
  return data;
}

// ---------------------------------------------------------------------------
// signup
// ---------------------------------------------------------------------------

export const signupCommand = SimpleCLI.command({
  description: "Open the hosted-platform sign-up page",
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .handle(async () => {
    await runBrowserAuthFlow({
      mode: "signup",
      apiUrl: resolveHostedApiUrl(),
      websiteUrl: resolveHostedWebsiteUrl(),
    });
  });

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

export const loginCommand = SimpleCLI.command({
  description: "Open the hosted-platform sign-in page",
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .handle(async () => {
    await runBrowserAuthFlow({
      mode: "login",
      apiUrl: resolveHostedApiUrl(),
      websiteUrl: resolveHostedWebsiteUrl(),
    });
  });

export const logoutCommand = SimpleCLI.command({
  description: "Clear local libretto credentials",
})
  .handle(async () => {
    const state = await readAuthState();
    if (state?.session?.cookie) {
      try {
        await betterAuthCall({
          apiUrl: state.apiUrl,
          path: "/api/auth/sign-out",
          credential: { source: "cookie", cookie: state.session.cookie },
        });
      } catch {
        // best-effort; clearing local state is the important part.
      }
    }
    await clearAuthState();
    console.log("Logged out.");
  });

// ---------------------------------------------------------------------------
// invite
// ---------------------------------------------------------------------------

export const inviteCommand = SimpleCLI.command({
  description: "Invite a teammate to your active organization",
})
  .input(
    SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("email", z.string().email(), {
          help: "Email address of the person to invite.",
        }),
      ],
      named: {
        role: SimpleCLI.option(
          z
            .enum(["member", "owner"])
            .default("member"),
          { help: "Role to assign (default: member)." },
        ),
      },
    }),
  )
  .handle(async ({ input }) => {
    const state = await readAuthState();
    const apiUrl = resolveApiUrl(state);
    const credential = pickCredential(state);
    if (credential.source === "none") {
      throw new Error(NOT_AUTHENTICATED_MESSAGE);
    }

    // Always resolve the org id explicitly. Better Auth's invite-member
    // 404s with "Organization not found" if neither `organizationId` is
    // passed nor an active-org is set on the session — and API-key
    // sessions don't carry an active-org by default.
    const organizationId = await resolveActiveOrgId(apiUrl, credential);

    const body: Record<string, unknown> = {
      email: input.email,
      role: input.role,
      organizationId,
    };

    const { data } = await betterAuthCall<{
      id: string;
      email: string;
      role: string;
      organizationId: string;
      expiresAt: string;
    }>({
      apiUrl,
      path: "/api/auth/organization/invite-member",
      input: body,
      credential,
    });

    // Fetch the inviter's org so we can print the website invite link for
    // manual testing and support cases where the email is unavailable.
    const { data: orgs } = await betterAuthCall<
      Array<{ id: string; name: string; slug: string | null }>
    >({
      apiUrl,
      path: "/api/auth/organization/list",
      method: "GET",
      credential,
    });
    const org = orgs?.find((o) => o.id === data.organizationId);
    const orgName = org?.name ?? "<your-org-name>";
    const orgSlug = org?.slug ?? "<your-org-slug>";
    const inviteUrl = new URL("/invite", resolveHostedWebsiteUrl());
    inviteUrl.searchParams.set("tenantSlug", orgSlug);
    inviteUrl.searchParams.set("invitationId", data.id);
    inviteUrl.searchParams.set("accept", "1");

    console.log(`Invitation sent to ${data.email}.`);
    console.log(`Invitation id: ${data.id}`);
    console.log(`Organization:  ${orgName} (${orgSlug})`);
    console.log(`Expires at:    ${data.expiresAt}`);
    console.log();
    console.log("Invite link:");
    console.log(`  ${inviteUrl.toString()}`);
  });

// ---------------------------------------------------------------------------
// api-key issue / list / revoke
// ---------------------------------------------------------------------------

export const apiKeyIssueCommand = SimpleCLI.command({
  description: "Issue a new API key for the active organization",
})
  .input(
    SimpleCLI.input({
      positionals: [],
      named: {
        label: SimpleCLI.option(z.string(), {
          help:
            "Label to identify this key (e.g. 'laptop-dev', 'github-actions').",
        }),
      },
    }),
  )
  .handle(async ({ input }) => {
    const stored = await readAuthState();
    const apiUrl = resolveApiUrl(stored);
    const credential = pickCredential(stored);
    if (credential.source === "none") {
      throw new Error(NOT_AUTHENTICATED_MESSAGE);
    }

    const key = await issueApiKey(apiUrl, input.label, credential);

    console.log(`API key issued (id: ${key.id}, label: ${key.name ?? input.label}).`);
    console.log(`Key (shown once — keep it safe):`);
    console.log(`  ${key.key}`);
    console.log();
    console.log("Add the following to your project's .env file:");
    console.log(`  LIBRETTO_API_KEY=${key.key}`);
    console.log();
    console.log(
      "The key is not stored on disk by the CLI — losing it means revoking + re-issuing.",
    );
  });

export const apiKeyListCommand = SimpleCLI.command({
  description: "List API keys for the active organization",
})
  .handle(async () => {
    const stored = await readAuthState();
    const apiUrl = resolveApiUrl(stored);
    const credential = pickCredential(stored);
    if (credential.source === "none") {
      throw new Error(NOT_AUTHENTICATED_MESSAGE);
    }

    const { data } = await betterAuthCall<ApiKeyListItem[]>({
      apiUrl,
      path: "/api/auth/api-key/list",
      method: "GET",
      credential,
    });

    if (!Array.isArray(data) || data.length === 0) {
      console.log("No API keys.");
      return;
    }

    for (const key of data) {
      const enabled = key.enabled === false ? " [disabled]" : "";
      const last = key.lastRequest ? ` last-used ${key.lastRequest}` : "";
      console.log(
        `${key.id}  ${key.name ?? "(unnamed)"}  ${key.start ?? key.prefix ?? ""}…  created ${key.createdAt}${enabled}${last}`,
      );
    }
  });

export const apiKeyRevokeCommand = SimpleCLI.command({
  description: "Revoke an API key by id",
})
  .input(
    SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("id", z.string().min(1), {
          help: "API key id (from `libretto cloud auth api-key list`).",
        }),
      ],
      named: {},
    }),
  )
  .handle(async ({ input }) => {
    const stored = await readAuthState();
    const apiUrl = resolveApiUrl(stored);
    const credential = pickCredential(stored);
    if (credential.source === "none") {
      throw new Error(NOT_AUTHENTICATED_MESSAGE);
    }

    await betterAuthCall({
      apiUrl,
      path: "/api/auth/api-key/delete",
      input: { keyId: input.id },
      credential,
    });

    console.log(`API key ${input.id} revoked.`);
    console.log(
      "If this key was in your .env, remove the LIBRETTO_API_KEY value and issue a new one with `libretto cloud auth api-key issue --label <label>`.",
    );
  });

// ---------------------------------------------------------------------------
// whoami
// ---------------------------------------------------------------------------

export const whoamiCommand = SimpleCLI.command({
  description: "Print the active session and credential source",
})
  .handle(async () => {
    const stored = await readAuthState();
    const credential = pickCredential(stored);

    const envKey = process.env.LIBRETTO_API_KEY?.trim();

    if (credential.source === "none") {
      console.log(
        "Not authenticated. Run `libretto cloud auth signup`, `libretto cloud auth login`, or set LIBRETTO_API_KEY in your env.",
      );
      return;
    }

    console.log(`Auth source:      ${credential.source}`);
    console.log(`API URL:          ${resolveHostedApiUrl()}`);
    console.log(
      `LIBRETTO_API_KEY: ${envKey ? `set in env (${envKey.slice(0, 6)}…)` : "not set in env"}`,
    );
    if (stored?.session) {
      console.log(`Session email:    ${stored.session.email}`);
      console.log(`Session user id:  ${stored.session.userId}`);
      if (stored.session.expiresAt) {
        console.log(`Session expires:  ${stored.session.expiresAt}`);
      }
      console.log(`Session file:     ${authStatePath()}`);
    } else {
      console.log("Session file:     (none on disk)");
    }
  });

// ---------------------------------------------------------------------------
// Group export
// ---------------------------------------------------------------------------

export const authCommands = SimpleCLI.group({
  description: "Hosted-platform auth commands",
  routes: {
    signup: signupCommand,
    login: loginCommand,
    logout: logoutCommand,
    invite: inviteCommand,
    whoami: whoamiCommand,
    "api-key": SimpleCLI.group({
      description: "Manage API keys",
      routes: {
        issue: apiKeyIssueCommand,
        list: apiKeyListCommand,
        revoke: apiKeyRevokeCommand,
      },
    }),
  },
});
