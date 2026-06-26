import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "wouter";
import { Navbar } from "./components/Navbar";
import {
  authPost,
  getCloudSession,
  orpcCall,
  type CloudSession,
} from "./cloudApi";

type AuthResponse = {
  redirect?: boolean;
  url?: string;
};

type InviteDetails = {
  invitationId: string;
  email: string;
  organizationName: string;
  organizationSlug: string;
  status: string;
  expiresAt: string;
};

type AcceptResponse = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
};

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function getInviteParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    invitationId: params.get("invitationId")?.trim() ?? "",
    tenantSlug: params.get("tenantSlug")?.trim() ?? "",
    shouldAccept: params.get("accept") === "1",
  };
}

function inviteCallbackUrl(): string {
  const { invitationId, tenantSlug } = getInviteParams();
  const url = new URL("/invite", window.location.origin);
  url.searchParams.set("tenantSlug", tenantSlug);
  url.searchParams.set("invitationId", invitationId);
  url.searchParams.set("accept", "1");
  return url.toString();
}

function formatExpiration(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function InvitePage() {
  const { invitationId, tenantSlug, shouldAccept } = useMemo(
    () => getInviteParams(),
    [],
  );
  const hasInvite = invitationId.length > 0 && tenantSlug.length > 0;
  const [details, setDetails] = useState<InviteDetails | null>(null);
  const [session, setSession] = useState<CloudSession | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState<"google" | "email" | "accept" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const autoAcceptAttempted = useRef(false);

  async function acceptInvite() {
    setLoading("accept");
    setError(null);
    try {
      await orpcCall<AcceptResponse>("/v1/auth/acceptInviteForCurrentUser", {
        invitationId,
        tenantSlug,
      });
      window.location.assign("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept invite.");
      setLoading(null);
    }
  }

  useEffect(() => {
    if (!hasInvite) {
      setChecking(false);
      return;
    }

    Promise.all([
      orpcCall<InviteDetails>("/v1/auth/inviteDetails", {
        invitationId,
        tenantSlug,
      }),
      getCloudSession().catch(() => null),
    ])
      .then(([inviteDetails, currentSession]) => {
        setDetails(inviteDetails);
        setSession(currentSession);
        setName(currentSession?.user.name ?? "");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not load invite.");
      })
      .finally(() => setChecking(false));
  }, [hasInvite, invitationId, tenantSlug]);

  useEffect(() => {
    if (
      !checking &&
      shouldAccept &&
      session &&
      details &&
      !autoAcceptAttempted.current
    ) {
      autoAcceptAttempted.current = true;
      void acceptInvite();
    }
  }, [checking, details, session, shouldAccept]);

  async function signUpWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    setLoading("email");
    setError(null);
    try {
      await authPost<AuthResponse>("/api/auth/sign-up/email", {
        name,
        email: details.email,
        password,
        callbackURL: inviteCallbackUrl(),
      });
      await acceptInvite();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed.");
      setLoading(null);
    }
  }

  async function continueWithGoogle() {
    setLoading("google");
    setError(null);
    try {
      const result = await authPost<AuthResponse>("/api/auth/sign-in/social", {
        provider: "google",
        callbackURL: inviteCallbackUrl(),
      });
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      window.location.assign(inviteCallbackUrl());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google authentication failed.");
      setLoading(null);
    }
  }

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto flex min-h-[calc(100vh-96px)] w-full max-w-[980px] items-center px-6 py-10">
        <section className="grid w-full gap-10 md:grid-cols-[1fr_440px] md:items-center">
          <div>
            <p className="mb-4 font-mono text-xs uppercase text-accent">
              Libretto Cloud
            </p>
            <h1 className="crt-glow max-w-[580px] font-serif text-[44px] font-[300] leading-[1.02] text-ink md:text-[58px]">
              Accept your team invite.
            </h1>
            <p className="mt-6 max-w-[520px] text-sm leading-6 text-muted">
              Join the workspace tied to this invitation and use the same
              account from the dashboard and CLI.
            </p>
          </div>

          <div className="rounded-lg border border-rule bg-panel/85 p-5 shadow-2xl shadow-black/25">
            {!hasInvite ? (
              <div className="space-y-5">
                <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-200">
                  This invite link is missing its invitation details.
                </p>
                <Link
                  className="libretto-button libretto-button--default h-10 w-full"
                  href="/"
                >
                  Go home
                </Link>
              </div>
            ) : checking ? (
              <div className="rounded-md border border-rule bg-bg/70 px-4 py-8 text-center text-sm text-muted">
                Checking invite...
              </div>
            ) : details ? (
              <div className="space-y-5">
                <div className="rounded-md border border-rule bg-bg/70 p-4">
                  <p className="text-xs uppercase text-muted">Workspace</p>
                  <p className="mt-1 text-lg text-ink">{details.organizationName}</p>
                  <p className="mt-1 font-mono text-xs text-muted">
                    {details.organizationSlug}
                  </p>
                  <p className="mt-3 text-xs text-muted">
                    Expires {formatExpiration(details.expiresAt)}
                  </p>
                </div>

                {session ? (
                  <div className="space-y-4">
                    <div className="rounded-md border border-rule bg-bg/70 p-4 text-sm leading-6 text-muted">
                      Signed in as{" "}
                      <span className="font-mono text-ink">{session.user.email}</span>
                    </div>
                    <button
                      type="button"
                      onClick={acceptInvite}
                      disabled={loading !== null}
                      className="libretto-button libretto-button--default h-10 w-full disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loading === "accept" ? "Accepting..." : "Accept invite"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <button
                      type="button"
                      onClick={continueWithGoogle}
                      disabled={loading !== null}
                      className="flex h-11 w-full items-center justify-center gap-3 rounded-md border border-rule bg-bg/70 px-4 text-sm font-medium text-ink shadow-sm shadow-black/20 transition-colors hover:border-accent/45 hover:bg-panel-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="grid size-6 place-items-center rounded-full bg-ink">
                        <GoogleLogo />
                      </span>
                      {loading === "google"
                        ? "Opening Google..."
                        : "Continue with Google"}
                    </button>

                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-rule" />
                      <span className="text-xs uppercase text-muted/70">or</span>
                      <div className="h-px flex-1 bg-rule" />
                    </div>

                    <form className="space-y-4" onSubmit={signUpWithEmail}>
                      <label className="block">
                        <span className="mb-2 block text-xs uppercase text-muted">
                          Name
                        </span>
                        <input
                          type="text"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          autoComplete="name"
                          required
                          className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/45 focus:border-accent"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-xs uppercase text-muted">
                          Email
                        </span>
                        <input
                          type="email"
                          value={details.email}
                          readOnly
                          className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm text-muted outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-xs uppercase text-muted">
                          Password
                        </span>
                        <input
                          type="password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          autoComplete="new-password"
                          minLength={8}
                          required
                          className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/45 focus:border-accent"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={loading !== null}
                        className="libretto-button libretto-button--default h-10 w-full disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {loading === "email" || loading === "accept"
                          ? "Accepting..."
                          : "Create account and accept"}
                      </button>
                    </form>
                  </div>
                )}

                {error && (
                  <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-200">
                    {error}
                  </p>
                )}
              </div>
            ) : (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-200">
                {error ?? "Could not load invite."}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
