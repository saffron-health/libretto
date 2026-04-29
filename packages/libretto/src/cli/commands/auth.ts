/**
 * Experimental auth commands for the libretto hosted platform.
 *
 *   libretto experimental auth signup
 *   libretto experimental auth login
 *   libretto experimental auth logout
 *   libretto experimental auth invite <email> [--role member|admin|owner]
 *   libretto experimental auth accept-invite <tenantSlug> <invitationId>
 *   libretto experimental auth api-key issue [--label <label>]
 *   libretto experimental auth api-key list
 *   libretto experimental auth api-key revoke <id>
 *   libretto experimental auth whoami
 *
 * Credentials live at ~/.libretto/auth.json (mode 0600). The CLI sends either
 * the stored API key or the stored session cookie depending on what's
 * available, with LIBRETTO_API_KEY winning when set.
 */

import { z } from "zod";
import { SimpleCLI } from "../framework/simple-cli.js";
import {
  ApiCallError,
  betterAuthCall,
  HOSTED_API_URL,
  NOT_AUTHENTICATED_MESSAGE,
  orpcCall,
  pickCredential,
  resolveApiUrl,
} from "../core/auth-fetch.js";
import {
  authStatePath,
  clearAuthState,
  readAuthState,
  setCookieToCookieHeader,
  writeAuthState,
  type AuthState,
} from "../core/auth-storage.js";
import { prompt, promptPassword, slugify } from "../core/prompt.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isSlugTakenData(data: unknown): boolean {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { reason?: unknown }).reason === "slug_taken"
  );
}

type SignupResponse = {
  userId: string;
  email: string;
  organizationId: string;
  organizationSlug: string | null;
  sessionToken: string | null;
  setCookie: string[];
  emailVerified: boolean;
};

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

async function pollForVerification(
  apiUrl: string,
  pollIntervalMs = 4000,
  maxWaitMs = 10 * 60 * 1000,
): Promise<boolean> {
  // The signup flow writes the cookie to disk before this poll starts, so
  // the default credential pick in `betterAuthCall` (env key > stored
  // cookie) reads the right one.
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const session = await getCurrentSession(apiUrl);
    if (session?.user.emailVerified) return true;
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  console.log();
  return false;
}

async function persistSignupSession(
  apiUrl: string,
  result: SignupResponse,
): Promise<AuthState> {
  const cookie = setCookieToCookieHeader(result.setCookie);
  if (!cookie) {
    throw new Error("Sign-up did not return a session cookie. Check the server.");
  }
  const next: AuthState = {
    apiUrl,
    session: {
      cookie,
      userId: result.userId,
      email: result.email,
      expiresAt: null,
    },
  };
  await writeAuthState(next);
  return next;
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
  description: "Create a new hosted-platform account and organization",
  experimental: true,
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .handle(async () => {
    const apiUrl = HOSTED_API_URL;
    console.log("Sign up for libretto cloud");
    console.log();
    console.log("Heads up: a libretto user can only belong to one organization.");
    console.log(
      "If your team already has a libretto org, ask a teammate for an invite instead — switching orgs later isn't supported.",
    );
    console.log("Type 'q' at the name prompt to quit if that applies to you.");
    console.log();

    const name = await prompt("Your name:");
    if (name.toLowerCase() === "q" || name.length === 0) {
      console.log(
        "OK — ask an existing teammate to run `libretto experimental auth invite <your-email>` and then run `libretto experimental auth accept-invite <slug> <invitation-id>` from this machine.",
      );
      return;
    }

    const email = await prompt("Your email:");
    const password = await promptPassword("Choose a password (8+ chars):");

    const orgName = await prompt("Organization name:");
    const defaultSlug = slugify(orgName);
    let orgSlug = (await prompt("Organization slug:", { defaultValue: defaultSlug })).toLowerCase();
    const debugNotificationEmail = await prompt(
      "Alert email (for hosted workflow failures):",
      { defaultValue: email },
    );

    console.log();
    console.log("Creating account...");

    // Retry loop: if the server reports slug-taken (data.reason === "slug_taken"),
    // re-prompt for just the slug and try again — keeping the entered name,
    // email, and password. Other errors propagate.
    //
    // The server's slug pre-check (added to /v1/auth/signupAndCreateOrg)
    // catches the conflict before any user is created, so retrying doesn't
    // leave dangling user rows behind. The transaction-level unique-violation
    // catch carries the same `data.reason` so a race-loser is also handled.
    let result: SignupResponse;
    while (true) {
      try {
        result = await orpcCall<SignupResponse>({
          apiUrl,
          path: "/v1/auth/signupAndCreateOrg",
          input: {
            name,
            email,
            password,
            organizationName: orgName,
            organizationSlug: orgSlug,
            debugNotificationEmail,
          },
          unauthenticated: true,
        });
        break;
      } catch (e) {
        if (
          e instanceof ApiCallError &&
          e.code === "CONFLICT" &&
          isSlugTakenData(e.data)
        ) {
          console.log();
          console.log(e.message);
          orgSlug = (await prompt("Organization slug:")).toLowerCase();
          continue;
        }
        throw e;
      }
    }

    await persistSignupSession(apiUrl, result);

    console.log(`Account created. Verification email sent to ${result.email}.`);
    console.log("Click the link in the email to verify, then return here.");
    console.log("Waiting for verification");

    const verified = await pollForVerification(apiUrl);
    if (!verified) {
      console.log();
      console.log(
        "Timed out waiting for email verification. Click the link in the email when you're ready — your CLI session is already saved, no need to re-run signup.",
      );
      return;
    }

    console.log();
    console.log("Email verified. You're logged in.");
    console.log(`Session saved to ${authStatePath()}`);
    console.log();
    console.log("To generate an API key, run:");
    console.log("  libretto experimental auth api-key issue --label <label>");
    console.log("Then add LIBRETTO_API_KEY=<key> to your project's .env file.");
  });

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

export const loginCommand = SimpleCLI.command({
  description: "Sign in to an existing hosted-platform account",
  experimental: true,
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .handle(async () => {
    const apiUrl = HOSTED_API_URL;

    const email = await prompt("Email:");
    const password = await promptPassword("Password:");

    const { data, setCookie } = await betterAuthCall<{
      token: string;
      user: { id: string; email: string; emailVerified: boolean };
    }>({
      apiUrl,
      path: "/api/auth/sign-in/email",
      input: { email, password },
      unauthenticated: true,
    });

    const cookie = setCookieToCookieHeader(setCookie);
    if (!cookie) {
      throw new Error("Login response did not include a session cookie.");
    }

    // Pass the just-issued cookie explicitly — at this point we haven't
    // persisted it yet, so a default credential pick would read the stale
    // (or missing) cookie from disk.
    const session = await getCurrentSession(apiUrl, cookie);

    const next: AuthState = {
      apiUrl,
      session: {
        cookie,
        userId: data.user.id,
        email: data.user.email,
        expiresAt: session?.session.expiresAt ?? null,
      },
    };
    await writeAuthState(next);

    console.log(`Logged in as ${data.user.email}.`);
    if (!data.user.emailVerified) {
      console.log(
        "Heads up: your email isn't verified yet. Re-sending the verification link to your inbox — click it to finish setup.",
      );
      try {
        await betterAuthCall({
          apiUrl,
          path: "/api/auth/send-verification-email",
          input: {
            email: data.user.email,
            callbackURL: `${apiUrl}/auth/verified`,
          },
          unauthenticated: true,
        });
        console.log(`Verification email sent to ${data.user.email}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.log(
          `Couldn't resend the verification email (${message}). Try again, or hit /api/auth/send-verification-email directly.`,
        );
      }
    }
  });

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

export const logoutCommand = SimpleCLI.command({
  description: "Clear local libretto credentials",
  experimental: true,
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
  experimental: true,
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
            .enum(["member", "admin", "owner"])
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

    // Fetch the inviter's org so we can print the slug. The accept
    // command requires the recipient to type the slug as confirmation
    // (slug is uniquely indexed; name is not), so showing it here helps
    // the inviter share the right command.
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

    console.log(`Invitation sent to ${data.email}.`);
    console.log(`Invitation id: ${data.id}`);
    console.log(`Organization:  ${orgName} (${orgSlug})`);
    console.log(`Expires at:    ${data.expiresAt}`);
    console.log();
    console.log("Tell them to run:");
    console.log(
      `  libretto experimental auth accept-invite ${orgSlug} ${data.id}`,
    );
  });

// ---------------------------------------------------------------------------
// accept-invite
// ---------------------------------------------------------------------------

export const acceptInviteCommand = SimpleCLI.command({
  description: "Accept an organization invitation",
  experimental: true,
})
  .input(
    SimpleCLI.input({
      positionals: [
        SimpleCLI.positional(
          "tenantSlug",
          z
            .string()
            .min(2)
            .max(60)
            .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
              message:
                "Slug must be lowercase letters, numbers, and hyphens (no leading/trailing hyphen).",
            }),
          {
            help:
              "Slug of the organization you're joining. Must match the org slug in the invitation email — acts as a confirmation step.",
          },
        ),
        SimpleCLI.positional("invitationId", z.string().min(1), {
          help: "Invitation id from the invite email.",
        }),
      ],
      named: {},
    }),
  )
  .handle(async ({ input }) => {
    const stored = await readAuthState();
    const apiUrl = HOSTED_API_URL;
    const credential = pickCredential(stored);
    const expectedTenantSlug = input.tenantSlug;

    if (credential.source !== "none") {
      // Path A — already signed in. Better Auth will try to insert a row
      // into `members` for the new org, but `members.userId` is UNIQUE
      // (one libretto user = one organization). Pre-check the user's
      // existing memberships and refuse with a clear message rather than
      // letting it 500 with a Postgres constraint error.
      const { data: existingOrgs } = await betterAuthCall<Array<{ id: string }>>({
        apiUrl,
        path: "/api/auth/organization/list",
        method: "GET",
        credential,
      });
      if (Array.isArray(existingOrgs) && existingOrgs.length > 0) {
        throw new Error(
          [
            "You're already a member of an organization.",
            "A libretto user can only belong to one organization at a time.",
            "To accept this invite: log out, delete the existing account, and re-run `auth accept-invite` with a new account (or a fresh email).",
          ].join("\n"),
        );
      }

      // Confirmation step: fetch the invitation and require the user to
      // have typed the matching organization slug. Same lightweight
      // second-factor check that the public ORPC route enforces for
      // Path B. Slug is the right field here because `tenants.slug` is
      // uniquely indexed; `tenants.name` is not, so a name-based check
      // could be bypassed by a colliding lowercase name.
      const { data: invitation } = await betterAuthCall<{
        organizationName: string;
        organizationSlug: string | null;
        organizationId: string;
      }>({
        apiUrl,
        path: `/api/auth/organization/get-invitation?id=${encodeURIComponent(input.invitationId)}`,
        method: "GET",
        credential,
      });
      if (
        !invitation?.organizationSlug ||
        invitation.organizationSlug !== expectedTenantSlug
      ) {
        throw new Error(
          "Organization slug doesn't match this invitation. Double-check the slug shown in the invitation email.",
        );
      }

      await betterAuthCall<{ member: { organizationId: string } }>({
        apiUrl,
        path: "/api/auth/organization/accept-invitation",
        input: { invitationId: input.invitationId },
        credential,
      });
      console.log(`Invitation accepted. You're now a member of ${invitation.organizationName}.`);
      return;
    }

    // Not signed in: collect a name + password and call the public ORPC route.
    // The server validates tenantSlug against the invitation server-side too.
    console.log("Accepting invite — let's create your account.");
    const name = await prompt("Your name:");
    const password = await promptPassword("Choose a password (8+ chars):");

    const result = await orpcCall<SignupResponse>({
      apiUrl,
      path: "/v1/auth/acceptInviteAndSignup",
      input: {
        invitationId: input.invitationId,
        tenantSlug: input.tenantSlug,
        name,
        password,
      },
      unauthenticated: true,
    });

    await persistSignupSession(apiUrl, result);

    console.log(`Account created. Verification email sent to ${result.email}.`);
    console.log("Click the link in the email and return here.");
    console.log("Waiting for verification");

    const verified = await pollForVerification(apiUrl);
    if (!verified) {
      console.log();
      console.log(
        "Timed out waiting for email verification. Click the link in the email when ready — your CLI session is already saved.",
      );
      return;
    }

    console.log();
    console.log("Email verified. You're logged in and a member of the organization.");
    console.log("To generate an API key, run:");
    console.log("  libretto experimental auth api-key issue --label <label>");
    console.log("Then add LIBRETTO_API_KEY=<key> to your project's .env file.");
  });

// ---------------------------------------------------------------------------
// api-key issue / list / revoke
// ---------------------------------------------------------------------------

export const apiKeyIssueCommand = SimpleCLI.command({
  description: "Issue a new API key for the active organization",
  experimental: true,
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
  experimental: true,
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
  experimental: true,
})
  .input(
    SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("id", z.string().min(1), {
          help: "API key id (from `auth api-key list`).",
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
      "If this key was in your .env, remove the LIBRETTO_API_KEY value and issue a new one with `auth api-key issue --label <label>`.",
    );
  });

// ---------------------------------------------------------------------------
// whoami
// ---------------------------------------------------------------------------

export const whoamiCommand = SimpleCLI.command({
  description: "Print the active session and credential source",
  experimental: true,
})
  .handle(async () => {
    const stored = await readAuthState();
    const credential = pickCredential(stored);

    const envKey = process.env.LIBRETTO_API_KEY?.trim();

    if (credential.source === "none") {
      console.log(
        "Not authenticated. Run `libretto experimental auth signup`, `login`, or set LIBRETTO_API_KEY in your env.",
      );
      return;
    }

    console.log(`Auth source:      ${credential.source}`);
    console.log(`API URL:          ${HOSTED_API_URL}`);
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
    "accept-invite": acceptInviteCommand,
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
